# frozen_string_literal: true

class ::DiscourseTimedGroups::AdminController < ::ApplicationController
  requires_plugin TIMED_GROUPS_PLUGIN_NAME
  before_action :ensure_admin

  # GET /timed-groups/admin/memberships
  # Optional params: group_id, status (active|expired|all)
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

    render json: {
      memberships: memberships.map { |m| serialize_membership(m) },
    }
  end

  # POST /timed-groups/admin/memberships
  # Params: username (or user_id), group_id, expires_at, starts_at (opt), note (opt)
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
      # Add user to Discourse group if not already member
      group.add(user) unless group.users.include?(user)

      render json: { membership: serialize_membership(membership.reload) }
    else
      render json: { errors: membership.errors.full_messages }, status: 422
    end
  end

  # PUT /timed-groups/admin/memberships/:id
  # Params: expires_at, note (opt), starts_at (opt)
  def update
    membership = ::TimedGroupMembership.find(params[:id])

    attrs = {}
    attrs[:expires_at] = Time.parse(params[:expires_at]) if params[:expires_at].present?
    attrs[:starts_at]  = Time.parse(params[:starts_at])  if params[:starts_at].present?
    attrs[:note]        = params[:note]                    if params.key?(:note)

    # Reset notification flag if expiry was extended
    if attrs[:expires_at] && attrs[:expires_at] > membership.expires_at
      attrs[:notified_expiring] = false
    end

    if membership.update(attrs)
      render json: { membership: serialize_membership(membership.reload) }
    else
      render json: { errors: membership.errors.full_messages }, status: 422
    end
  end

  # DELETE /timed-groups/admin/memberships/:id
  def destroy
    membership = ::TimedGroupMembership.find(params[:id])
    group = membership.group
    user  = membership.user

    membership.destroy!

    # Remove user from Discourse group
    group.remove(user) if group.users.include?(user)

    render json: { success: true }
  end

  # POST /timed-groups/admin/memberships/bulk_extend
  # Params: group_id, days
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

  # GET /timed-groups/admin/groups
  # Returns all non-automatic groups for the dropdown
  def available_groups
    groups = Group.where(automatic: false).order(:name).map do |g|
      { id: g.id, name: g.name, full_name: g.full_name }
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
