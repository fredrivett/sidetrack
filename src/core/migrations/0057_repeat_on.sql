ALTER TABLE `items` ADD `repeat_on` text;--> statement-breakpoint
-- A weekly or monthly item due on a weekend came back on a weekend before
-- rules said which days they keep to: keep it so.
UPDATE `items` SET `repeat_on` = 'weekend'
WHERE `repeat_unit` IN ('week', 'month')
  AND `due_from` IS NOT NULL
  AND strftime('%w', `due_from`) = '6'
  AND `due_date` = date(`due_from`, '+1 day');
