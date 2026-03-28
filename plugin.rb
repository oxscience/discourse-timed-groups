# frozen_string_literal: true

# name: discourse-timed-groups
# about: Zeitlich begrenzte Gruppenmitgliedschaften fuer Discourse
# version: 0.1.0
# authors: Pat (Out Of The Box Science)
# url: https://github.com/oxscience/discourse-timed-groups
# required_version: 2.7.0

enabled_site_setting :timed_groups_enabled

TIMED_GROUPS_PLUGIN_NAME = "discourse-timed-groups"

module ::DiscourseTimedGroups
  class Engine < ::Rails::Engine
    engine_name TIMED_GROUPS_PLUGIN_NAME
    isolate_namespace DiscourseTimedGroups
  end
end

after_initialize do
  # Load model, controller, job
  require_relative "app/models/timed_group_membership"
  require_relative "app/controllers/timed_groups_admin_controller"
  require_relative "app/jobs/scheduled/expire_timed_memberships"

  # Admin sidebar link
  add_admin_route "timed_groups.admin_title", "timed-groups"

  # API Routes
  DiscourseTimedGroups::Engine.routes.draw do
    scope "/admin", defaults: { format: :json } do
      get    "/memberships"            => "admin#index"
      post   "/memberships"            => "admin#create"
      put    "/memberships/:id"        => "admin#update"
      delete "/memberships/:id"        => "admin#destroy"
      post   "/memberships/bulk_extend" => "admin#bulk_extend"
      get    "/groups"                 => "admin#available_groups"
    end
  end

  Discourse::Application.routes.append do
    mount ::DiscourseTimedGroups::Engine, at: "/timed-groups"
  end

  # Hook: when a user is removed from a group manually, clean up timed record
  on(:user_removed_from_group) do |user, group|
    if defined?(::TimedGroupMembership)
      ::TimedGroupMembership.where(user_id: user.id, group_id: group.id).destroy_all
    end
  end
end
