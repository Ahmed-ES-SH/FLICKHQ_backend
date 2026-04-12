import { MigrationInterface, QueryRunner } from "typeorm";

export class User1775154812296 implements MigrationInterface {
    name = 'User1775154812296'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'user')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" SERIAL NOT NULL, "email" character varying NOT NULL, "password" character varying, "name" character varying, "avatar" character varying, "role" "public"."users_role_enum" NOT NULL DEFAULT 'user', "googleId" character varying, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "isEmailVerified" boolean NOT NULL DEFAULT false, "emailVerificationToken" character varying, "emailVerificationTokenExpiry" TIMESTAMP, "passwordResetToken" character varying, "passwordResetTokenExpiry" TIMESTAMP, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_51b8b26ac168fbe7d6f5653e6cf" UNIQUE ("name"), CONSTRAINT "UQ_f382af58ab36057334fb262efd5" UNIQUE ("googleId"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "black_list_tokens" ("id" SERIAL NOT NULL, "token" character varying NOT NULL, "userId" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a136c27667742b133d262dd411f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_8eb1cabd6b6e30a13c1dc85326" ON "black_list_tokens" ("token") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_8eb1cabd6b6e30a13c1dc85326"`);
        await queryRunner.query(`DROP TABLE "black_list_tokens"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
