CREATE TABLE "badges" (
	"learner_id" text NOT NULL,
	"gym_id" text NOT NULL,
	"earned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badges_learner_id_gym_id_pk" PRIMARY KEY("learner_id","gym_id")
);
--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badges" ADD CONSTRAINT "badges_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE no action ON UPDATE no action;