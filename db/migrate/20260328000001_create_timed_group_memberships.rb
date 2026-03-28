# frozen_string_literal: true

class CreateTimedGroupMemberships < ActiveRecord::Migration[7.0]
  def change
    create_table :timed_group_memberships do |t|
      t.integer  :user_id,           null: false
      t.integer  :group_id,          null: false
      t.datetime :starts_at,         null: false
      t.datetime :expires_at,        null: false
      t.integer  :created_by_id
      t.string   :note
      t.boolean  :notified_expiring, default: false, null: false
      t.timestamps
    end

    add_index :timed_group_memberships, %i[user_id group_id], unique: true,
              name: "idx_timed_group_memberships_user_group"
    add_index :timed_group_memberships, :expires_at,
              name: "idx_timed_group_memberships_expires_at"
    add_index :timed_group_memberships, :group_id,
              name: "idx_timed_group_memberships_group_id"
  end
end
