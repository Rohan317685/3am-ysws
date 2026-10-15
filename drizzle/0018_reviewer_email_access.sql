-- Refresh the email used for reviewer identity matching. Slack ID remains the primary key.
UPDATE "reviewers"
SET "email" = 'owaisahmad1561@gmail.com'
WHERE "slack_id" = 'U090254RL9L';
