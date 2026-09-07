ALTER TABLE "project_index" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "project_index" ADD COLUMN "color" text;--> statement-breakpoint

UPDATE "project_index" SET
  icon = (ARRAY[
    '🚀','📦','🎯','⚙️','🧪','📚','🎨','💡','🔧','🌱',
    '⚡','🎮','🛠','🧭','🔬','📊','🏗','🪐','🔮','🏷'
  ])[1 + (('x' || left(md5(slug), 8))::bit(32)::bigint & x'7fffffff'::bigint)::int % 20],
  color = (ARRAY[
    '#f16f7e','#ed7940','#d78d00','#aea200','#70b445','#00bc85','#00bbbd',
    '#00b1e8','#53a0ff','#968dfd','#c37de2','#e271b5','#f16f7e'
  ])[1 + (('x' || left(md5(slug || ':color'), 8))::bit(32)::bigint & x'7fffffff'::bigint)::int % 13]
WHERE icon IS NULL OR color IS NULL;--> statement-breakpoint

ALTER TABLE "project_index" ALTER COLUMN "icon" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_index" ALTER COLUMN "color" SET NOT NULL;
