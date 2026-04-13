import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMoviesListsPaymentsTables1775975939705 implements MigrationInterface {
    name = 'AddMoviesListsPaymentsTables1775975939705'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "contact_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "full_name" character varying(100) NOT NULL, "email" character varying(255) NOT NULL, "subject" character varying(200) NOT NULL, "message" text NOT NULL, "is_read" boolean NOT NULL DEFAULT false, "replied_at" TIMESTAMP, "ip_address" character varying(45), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b74f96eb2edd977ccfba6533293" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_contact_messages_created_at" ON "contact_messages" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "idx_contact_messages_is_read" ON "contact_messages" ("is_read") `);
        await queryRunner.query(`CREATE TABLE "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "slug" character varying(120) NOT NULL, "description" text, "color" character varying(7), "icon" character varying(50), "order" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_420d9f679d41281f282f5bc7d09" UNIQUE ("slug"), CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3a10aa36cee83153e97161ab26" ON "categories" ("order") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_420d9f679d41281f282f5bc7d0" ON "categories" ("slug") `);
        await queryRunner.query(`CREATE TABLE "articles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(300) NOT NULL, "slug" character varying(350) NOT NULL, "excerpt" text, "content" text NOT NULL, "coverImageUrl" character varying, "tags" text array NOT NULL DEFAULT '{}', "category_id" uuid, "isPublished" boolean NOT NULL DEFAULT false, "publishedAt" TIMESTAMP, "readTimeMinutes" integer NOT NULL DEFAULT '0', "viewsCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_1123ff6815c5b8fec0ba9fec370" UNIQUE ("slug"), CONSTRAINT "PK_0a6e2c450d83e0b6052c2793334" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_e025eeefcdb2a269c42484ee43" ON "articles" ("category_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_3fddf7592d60b1d2c483214d87" ON "articles" ("isPublished", "publishedAt") `);
        await queryRunner.query(`CREATE TYPE "public"."notifications_type_enum" AS ENUM('ORDER_UPDATED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'SYSTEM', 'BROADCAST')`);
        await queryRunner.query(`CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "type" "public"."notifications_type_enum" NOT NULL DEFAULT 'SYSTEM', "title" character varying(255) NOT NULL, "message" text NOT NULL, "data" jsonb, "is_read" boolean NOT NULL DEFAULT false, "read_at" TIMESTAMP, "is_deleted" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_77ee7b06d6f802000c0846f3a5" ON "notifications" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_aef1c7aef3725068e5540f8f00" ON "notifications" ("type") `);
        await queryRunner.query(`CREATE INDEX "IDX_f12148ce379462ebbb4d06cc13" ON "notifications" ("is_read") `);
        await queryRunner.query(`CREATE INDEX "IDX_9a8a82462cab47c73d25f49261" ON "notifications" ("user_id") `);
        await queryRunner.query(`CREATE TABLE "notification_preferences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "order_notifications" boolean NOT NULL DEFAULT true, "payment_notifications" boolean NOT NULL DEFAULT true, "system_notifications" boolean NOT NULL DEFAULT true, "email_enabled" boolean NOT NULL DEFAULT true, "push_enabled" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_64c90edc7310c6be7c10c96f675" UNIQUE ("user_id"), CONSTRAINT "PK_e94e2b543f2f218ee68e4f4fad2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_64c90edc7310c6be7c10c96f67" ON "notification_preferences" ("user_id") `);
        await queryRunner.query(`CREATE TABLE "movies" ("id" SERIAL NOT NULL, "tmdbId" integer NOT NULL, "title" character varying(500) NOT NULL, "overview" text, "poster_path" text, "backdrop_path" text, "release_date" date, "vote_average" numeric(3,1), "genres" jsonb NOT NULL DEFAULT '[]', "runtime" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_e9d4a90d2d6a56fd9f9300c9370" UNIQUE ("tmdbId"), CONSTRAINT "PK_c5b2c134e871bfd1c2fe7cc3705" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."user_lists_list_type_enum" AS ENUM('watchlist', 'watched', 'favorites')`);
        await queryRunner.query(`CREATE TABLE "user_lists" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "movie_id" integer NOT NULL, "list_type" "public"."user_lists_list_type_enum" NOT NULL, "watched_at" TIMESTAMP, "rating" smallint, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_0c7e33f16495188853670f88134" UNIQUE ("user_id", "movie_id", "list_type"), CONSTRAINT "PK_5b95dd451cc96d45846e5e8db04" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_user_lists_created_at" ON "user_lists" ("user_id", "list_type", "createdAt") `);
        await queryRunner.query(`CREATE INDEX "idx_user_lists_movie_id" ON "user_lists" ("movie_id") `);
        await queryRunner.query(`CREATE INDEX "idx_user_lists_user_list_type" ON "user_lists" ("user_id", "list_type") `);
        await queryRunner.query(`CREATE INDEX "idx_user_lists_user_id" ON "user_lists" ("user_id") `);
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum" AS ENUM('pending', 'succeeded', 'failed', 'refunded')`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "stripe_payment_intent" character varying(255) NOT NULL, "stripe_charge_id" character varying(255), "amount" integer NOT NULL, "currency" character varying(10) NOT NULL DEFAULT 'usd', "status" "public"."payments_status_enum" NOT NULL DEFAULT 'pending', "description" text, "metadata" jsonb NOT NULL DEFAULT '{}', "idempotency_key" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_664bedf216068b7e370d541bdfa" UNIQUE ("stripe_payment_intent"), CONSTRAINT "UQ_59dcef70bd19850783c84f840e5" UNIQUE ("idempotency_key"), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_payments_idempotency_key" ON "payments" ("idempotency_key") `);
        await queryRunner.query(`CREATE INDEX "idx_payments_status" ON "payments" ("status") `);
        await queryRunner.query(`CREATE INDEX "idx_payments_stripe_payment_intent" ON "payments" ("stripe_payment_intent") `);
        await queryRunner.query(`CREATE INDEX "idx_payments_user_id" ON "payments" ("user_id") `);
        await queryRunner.query(`CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'inactive', 'banned')`);
        await queryRunner.query(`ALTER TABLE "users" ADD "status" "public"."users_status_enum" NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`ALTER TABLE "articles" ADD CONSTRAINT "FK_e025eeefcdb2a269c42484ee43f" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_lists" ADD CONSTRAINT "FK_5727ac510aac753f9e2c0728cea" FOREIGN KEY ("movie_id") REFERENCES "movies"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_lists" DROP CONSTRAINT "FK_5727ac510aac753f9e2c0728cea"`);
        await queryRunner.query(`ALTER TABLE "articles" DROP CONSTRAINT "FK_e025eeefcdb2a269c42484ee43f"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "status"`);
        await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_payments_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_payments_stripe_payment_intent"`);
        await queryRunner.query(`DROP INDEX "public"."idx_payments_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_payments_idempotency_key"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_lists_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_lists_user_list_type"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_lists_movie_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_lists_created_at"`);
        await queryRunner.query(`DROP TABLE "user_lists"`);
        await queryRunner.query(`DROP TYPE "public"."user_lists_list_type_enum"`);
        await queryRunner.query(`DROP TABLE "movies"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_64c90edc7310c6be7c10c96f67"`);
        await queryRunner.query(`DROP TABLE "notification_preferences"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9a8a82462cab47c73d25f49261"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f12148ce379462ebbb4d06cc13"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_aef1c7aef3725068e5540f8f00"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_77ee7b06d6f802000c0846f3a5"`);
        await queryRunner.query(`DROP TABLE "notifications"`);
        await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3fddf7592d60b1d2c483214d87"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e025eeefcdb2a269c42484ee43"`);
        await queryRunner.query(`DROP TABLE "articles"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_420d9f679d41281f282f5bc7d0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3a10aa36cee83153e97161ab26"`);
        await queryRunner.query(`DROP TABLE "categories"`);
        await queryRunner.query(`DROP INDEX "public"."idx_contact_messages_is_read"`);
        await queryRunner.query(`DROP INDEX "public"."idx_contact_messages_created_at"`);
        await queryRunner.query(`DROP TABLE "contact_messages"`);
    }

}
