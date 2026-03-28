# frozen_string_literal: true

module Jobs
  class ExpireTimedMemberships < ::Jobs::Scheduled
    every 1.hour

    def execute(args)
      return unless SiteSetting.timed_groups_enabled

      expire_memberships
      notify_expiring_soon
    end

    private

    # Remove expired memberships and notify users
    def expire_memberships
      ::TimedGroupMembership.expired.includes(:user, :group).find_each do |membership|
        group = membership.group
        user  = membership.user

        # Remove user from Discourse group
        group.remove(user) if group.users.include?(user)

        # Send expiry notification
        if SiteSetting.timed_groups_notify_on_expiry
          SystemMessage.create_from_system_user(
            user,
            :timed_group_expired,
            group_name: group.full_name.presence || group.name,
          )
        end

        # Clean up the record
        membership.destroy!

        Rails.logger.info(
          "[TimedGroups] Expired membership: user=#{user.username} group=#{group.name}",
        )
      end
    end

    # Notify users whose membership expires within N days
    def notify_expiring_soon
      return unless SiteSetting.timed_groups_notify_before_expiry

      days = SiteSetting.timed_groups_days_before_expiry_notification

      ::TimedGroupMembership.expiring_soon(days).includes(:user, :group).find_each do |membership|
        SystemMessage.create_from_system_user(
          membership.user,
          :timed_group_expiring_soon,
          group_name: membership.group.full_name.presence || membership.group.name,
          days_remaining: membership.days_remaining,
          expires_at: I18n.l(membership.expires_at, format: :long),
        )

        membership.update!(notified_expiring: true)

        Rails.logger.info(
          "[TimedGroups] Notified expiring: user=#{membership.user.username} " \
          "group=#{membership.group.name} days=#{membership.days_remaining}",
        )
      end
    end
  end
end
