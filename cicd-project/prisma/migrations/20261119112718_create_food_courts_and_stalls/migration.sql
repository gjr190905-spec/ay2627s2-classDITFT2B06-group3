-- CreateTable
CREATE TABLE "food_courts" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "food_courts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls" (
    "id" SERIAL NOT NULL,
    "foodCourtId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "pickupLocation" VARCHAR(255) NOT NULL,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stalls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "food_courts_code_key" ON "food_courts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stalls_foodCourtId_name_key" ON "stalls"("foodCourtId", "name");

-- AddForeignKey
ALTER TABLE "stalls" ADD CONSTRAINT "stalls_foodCourtId_fkey" FOREIGN KEY ("foodCourtId") REFERENCES "food_courts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
