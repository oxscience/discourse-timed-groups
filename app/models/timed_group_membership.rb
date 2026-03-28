# frozen_string_literal: true

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
