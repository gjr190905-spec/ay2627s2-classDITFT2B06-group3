BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "makan_liao";

-- CreateTable
CREATE TABLE "makan_liao"."Person" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "makan_liao"."Something" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Something_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "makan_liao"."Person"("email");

COMMIT;
