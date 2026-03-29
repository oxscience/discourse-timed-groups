# frozen_string_literal: true

# name: discourse-timed-groups
# about: Zeitlich begrenzte Gruppenmitgliedschaften fuer Discourse
# version: 0.2.0
# authors: Pat (Out Of The Box Science)
# url: https://github.com/oxscience/discourse-timed-groups
# required_version: 2.7.0

enabled_site_setting :timed_groups_enabled

register_asset "stylesheets/timed-groups.scss"

TIMED_GROUPS_PLUGIN_NAME = "discourse-timed-groups"

after_initialize do
  # ── Model ─────────────────────────────────────────────
  class ::TimedGroupMembership < ActiveRecord::Base
    belongs_to :user
    belongs_to :group
    belongs_to :created_by, class_name: "User", optional: true

    validates :user_id,    presence: true
    validates :group_id,   presence: true
    validates :starts_at,  presence: true
    validates :expires_at, presence: true
    validates :user_id,    uniqueness: { scope: :group_id }
    validate  :expires_after_starts

    scope :expired, -> { where("expires_at < ?", Time.current) }

    scope :active, -> {
      where("expires_at >= ? AND starts_at <= ?", Time.current, Time.current)
    }

    scope :expiring_soon, ->(days = 7) {
      where(
        "expires_at BETWEEN ? AND ? AND notified_expiring = false",
        Time.current,
        days.days.from_now,
      )
    }

    def days_remaining
      [(expires_at.to_date - Date.current).to_i, 0].max
    end

    def active?
      starts_at <= Time.current && expires_at > Time.current
    end

    private

    def expires_after_starts
      return if starts_at.blank? || expires_at.blank?
      errors.add(:expires_at, "muss nach dem Startdatum liegen") if expires_at <= starts_at
    end
  end

  # ── Controller ────────────────────────────────────────
  class ::TimedGroupsAdminController < ::ApplicationController
    requires_plugin TIMED_GROUPS_PLUGIN_NAME
    before_action :ensure_admin

    def index
      memberships = ::TimedGroupMembership
        .includes(:user, :group, :created_by)
        .order(expires_at: :asc)

      memberships = memberships.where(group_id: params[:group_id]) if params[:group_id].present?

      case params[:status]
      when "active"
        memberships = memberships.active
      when "expired"
        memberships = memberships.expired
      end

      render json: { memberships: memberships.map { |m| serialize_membership(m) } }
    end

    def create
      user = find_user
      raise Discourse::NotFound.new("User not found") unless user

      group = Group.find(params[:group_id])

      membership = ::TimedGroupMembership.new(
        user_id: user.id,
        group_id: group.id,
        starts_at: params[:starts_at].present? ? Time.parse(params[:starts_at]) : Time.current,
        expires_at: Time.parse(params[:expires_at]),
        created_by_id: current_user.id,
        note: params[:note],
      )

      if membership.save
        group.add(user) unless group.users.include?(user)
        render json: { membership: serialize_membership(membership.reload) }
      else
        render json: { errors: membership.errors.full_messages }, status: 422
      end
    end

    def update
      membership = ::TimedGroupMembership.find(params[:id])

      attrs = {}
      attrs[:expires_at] = Time.parse(params[:expires_at]) if params[:expires_at].present?
      attrs[:starts_at]  = Time.parse(params[:starts_at])  if params[:starts_at].present?
      attrs[:note]        = params[:note]                    if params.key?(:note)

      if attrs[:expires_at] && attrs[:expires_at] > membership.expires_at
        attrs[:notified_expiring] = false
      end

      if membership.update(attrs)
        render json: { membership: serialize_membership(membership.reload) }
      else
        render json: { errors: membership.errors.full_messages }, status: 422
      end
    end

    def destroy
      membership = ::TimedGroupMembership.find(params[:id])
      group = membership.group
      user  = membership.user

      membership.destroy!
      group.remove(user) if group.users.include?(user)

      render json: { success: true }
    end

    def bulk_extend
      group_id = params[:group_id]
      days     = params[:days].to_i

      raise Discourse::InvalidParameters.new("group_id and days required") if group_id.blank? || days <= 0

      memberships = ::TimedGroupMembership.where(group_id: group_id).active
      count = 0

      memberships.find_each do |m|
        m.update!(expires_at: m.expires_at + days.days, notified_expiring: false)
        count += 1
      end

      render json: { updated: count }
    end

    # POST /timed-groups/admin/memberships/bulk_import
    # Import all current members of a group with a set duration
    # Params: group_id, days, note (opt)
    def bulk_import
      group = Group.find(params[:group_id])
      days  = params[:days].to_i

      raise Discourse::InvalidParameters.new("group_id and days required") if days <= 0

      created = 0
      skipped = 0

      group.users.find_each do |user|
        existing = ::TimedGroupMembership.find_by(user_id: user.id, group_id: group.id)
        if existing
          skipped += 1
          next
        end

        ::TimedGroupMembership.create!(
          user_id: user.id,
          group_id: group.id,
          starts_at: Time.current,
          expires_at: days.days.from_now,
          created_by_id: current_user.id,
          note: params[:note],
        )
        created += 1
      end

      render json: { created: created, skipped: skipped }
    end

    # GET /timed-groups/admin/auto_track
    # Returns auto-track settings per group
    # Format: { "group_id" => { "mode" => "individual"|"license", "days" => N, "expires_at" => "YYYY-MM-DD" } }
    def auto_track_index
      settings = PluginStore.get(TIMED_GROUPS_PLUGIN_NAME, "auto_track_groups") || {}
      # Migrate old format (plain integer) to new format
      settings.each do |gid, val|
        settings[gid] = { "mode" => "individual", "days" => val.to_i } if val.is_a?(Integer) || val.is_a?(String)
      end
      render json: { auto_track: settings }
    end

    # PUT /timed-groups/admin/auto_track
    # Params: group_id, mode ("individual"|"license"|"off"), days (for individual), expires_at (for license)
    def auto_track_update
      group_id = params[:group_id].to_s
      mode     = params[:mode] || "individual"

      settings = PluginStore.get(TIMED_GROUPS_PLUGIN_NAME, "auto_track_groups") || {}
      # Migrate old format
      settings.each do |gid, val|
        settings[gid] = { "mode" => "individual", "days" => val.to_i } if val.is_a?(Integer) || val.is_a?(String)
      end

      if mode == "off" || (mode == "individual" && params[:days].to_i <= 0)
        settings.delete(group_id)
      elsif mode == "individual"
        settings[group_id] = { "mode" => "individual", "days" => params[:days].to_i }
      elsif mode == "license"
        raise Discourse::InvalidParameters.new("expires_at required for license mode") if params[:expires_at].blank?
        settings[group_id] = { "mode" => "license", "expires_at" => params[:expires_at].to_s }
      end

      PluginStore.set(TIMED_GROUPS_PLUGIN_NAME, "auto_track_groups", settings)

      render json: { auto_track: settings }
    end

    def available_groups
      auto_settings = PluginStore.get(TIMED_GROUPS_PLUGIN_NAME, "auto_track_groups") || {}
      # Migrate old format
      auto_settings.each do |gid, val|
        auto_settings[gid] = { "mode" => "individual", "days" => val.to_i } if val.is_a?(Integer) || val.is_a?(String)
      end

      groups = Group.where(automatic: false).order(:name).map do |g|
        setting = auto_settings[g.id.to_s]
        {
          id: g.id,
          name: g.name,
          full_name: g.full_name,
          auto_track: setting,
        }
      end

      render json: { groups: groups }
    end

    private

    def find_user
      if params[:username].present?
        User.find_by(username: params[:username])
      elsif params[:user_id].present?
        User.find_by(id: params[:user_id])
      end
    end

    def serialize_membership(m)
      {
        id: m.id,
        user: {
          id: m.user.id,
          username: m.user.username,
          name: m.user.name,
          avatar_url: m.user.avatar_template.gsub("{size}", "48"),
        },
        group: {
          id: m.group.id,
          name: m.group.name,
          full_name: m.group.full_name,
        },
        starts_at: m.starts_at.iso8601,
        expires_at: m.expires_at.iso8601,
        created_by: m.created_by ? { username: m.created_by.username } : nil,
        note: m.note,
        active: m.active?,
        days_remaining: m.days_remaining,
        created_at: m.created_at.iso8601,
      }
    end
  end

  # ── Scheduled Job ─────────────────────────────────────
  module Jobs
    class ExpireTimedMemberships < ::Jobs::Scheduled
      every 1.hour

      def execute(args)
        return unless SiteSetting.timed_groups_enabled

        # Expire memberships
        ::TimedGroupMembership.expired.includes(:user, :group).find_each do |membership|
          group = membership.group
          user  = membership.user

          group.remove(user) if group.users.include?(user)

          if SiteSetting.timed_groups_notify_on_expiry
            SystemMessage.create_from_system_user(
              user,
              :timed_group_expired,
              group_name: group.full_name.presence || group.name,
            )
          end

          membership.destroy!
          Rails.logger.info("[TimedGroups] Expired: user=#{user.username} group=#{group.name}")
        end

        # Notify expiring soon
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
            "[TimedGroups] Notified: user=#{membership.user.username} " \
            "group=#{membership.group.name} days=#{membership.days_remaining}",
          )
        end
      end
    end
  end

  # ── Routes ────────────────────────────────────────────
  Discourse::Application.routes.append do
    scope "/timed-groups/admin", defaults: { format: :json } do
      get    "/memberships"              => "timed_groups_admin#index"
      post   "/memberships"              => "timed_groups_admin#create"
      put    "/memberships/:id"          => "timed_groups_admin#update"
      delete "/memberships/:id"          => "timed_groups_admin#destroy"
      post   "/memberships/bulk_extend"  => "timed_groups_admin#bulk_extend"
      post   "/memberships/bulk_import" => "timed_groups_admin#bulk_import"
      get    "/auto_track"              => "timed_groups_admin#auto_track_index"
      put    "/auto_track"              => "timed_groups_admin#auto_track_update"
      get    "/groups"                  => "timed_groups_admin#available_groups"
    end
  end

  # ── Admin sidebar link ────────────────────────────────
  add_admin_route "timed_groups.admin_title", "timed-groups"

  # ── Auto-track hook ───────────────────────────────────
  # When a user is added to a group with auto-track enabled,
  # automatically create a timed membership.
  # Supports two modes:
  #   - individual: each user gets X days from join date
  #   - license: fixed expiry for the group, latecomers get remaining time
  on(:user_added_to_group) do |user, group, opts|
    next unless SiteSetting.timed_groups_enabled

    all_settings = PluginStore.get(TIMED_GROUPS_PLUGIN_NAME, "auto_track_groups") || {}
    setting = all_settings[group.id.to_s]

    # Migrate old format (plain integer)
    setting = { "mode" => "individual", "days" => setting.to_i } if setting.is_a?(Integer) || setting.is_a?(String)
    next unless setting.is_a?(Hash) && setting["mode"].present?

    # Skip if already has a timed membership
    next if ::TimedGroupMembership.exists?(user_id: user.id, group_id: group.id)

    expires_at = nil
    note = nil

    if setting["mode"] == "individual" && setting["days"].to_i > 0
      expires_at = setting["days"].to_i.days.from_now
      note = "Auto-Track (#{setting["days"]}d)"
    elsif setting["mode"] == "license" && setting["expires_at"].present?
      expires_at = Time.parse(setting["expires_at"])
      # Skip if license already expired
      next if expires_at <= Time.current
      note = "Gruppenlizenz bis #{expires_at.strftime("%d.%m.%Y")}"
    end

    next unless expires_at

    ::TimedGroupMembership.create!(
      user_id: user.id,
      group_id: group.id,
      starts_at: Time.current,
      expires_at: expires_at,
      note: note,
    )

    Rails.logger.info(
      "[TimedGroups] Auto-tracked (#{setting["mode"]}): user=#{user.username} group=#{group.name}",
    )
  end

  # ── Cleanup hook ──────────────────────────────────────
  on(:user_removed_from_group) do |user, group|
    ::TimedGroupMembership.where(user_id: user.id, group_id: group.id).destroy_all
  end
end
