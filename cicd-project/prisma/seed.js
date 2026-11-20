const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const foodCourts = [
  { code: 'FC1', name: 'Food Court 1' },
  { code: 'FC2', name: 'Food Court 2' },
  { code: 'FC3', name: 'Food Court 3' },
  { code: 'FC4', name: 'Food Court 4' },
  { code: 'FC5', name: 'Food Court 5' },
  { code: 'FC6', name: 'Food Court 6' },
];

async function main() {
  const result = await prisma.foodCourt.createMany({
    data: foodCourts.map((foodCourt) => ({
      ...foodCourt,
      location: 'Location to be confirmed',
    })),
    skipDuplicates: true,
  });

  console.log(`Created ${result.count} food court records.`);

  for (const sampleStall of sampleStalls) {
  const foodCourt = await prisma.foodCourt.findUnique({
    where: {
      code: sampleStall.foodCourtCode,
    },
  });

  if (!foodCourt) {
    throw new Error(
      `Food court ${sampleStall.foodCourtCode} was not found.`,
    );
  }

  const stallResult = await prisma.stall.createMany({
    data: [
      {
        foodCourtId: foodCourt.id,
        name: sampleStall.name,
        pickupLocation: sampleStall.pickupLocation,
      },
    ],
    skipDuplicates: true,
  });

  console.log(
    `${sampleStall.name}: created ${stallResult.count} record(s).`,
  );
}

  const savedFoodCourts = await prisma.foodCourt.findMany({
    where: {
      code: {
        in: foodCourts.map((foodCourt) => foodCourt.code),
      },
    },
    orderBy: {
      code: 'asc',
    },
    select: {
      id: true,
      code: true,
      name: true,
      location: true,
      isActive: true,
    },
  });

  console.table(savedFoodCourts);
}

main()
  .catch((error) => {
    console.error('Food court seeding failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

  const sampleStalls = [
  {
    foodCourtCode: 'FC1',
    name: 'Chicken Rice',
    pickupLocation: 'Demo pickup point at FC1',
  },
  {
    foodCourtCode: 'FC1',
    name: 'Japanese Curry Rice',
    pickupLocation: 'Demo pickup point at FC1',
  },
  {
    foodCourtCode: 'FC2',
    name: 'Nasi Lemak',
    pickupLocation: 'Demo pickup point at FC2',
  },
  {
    foodCourtCode: 'FC2',
    name: 'Mala',
    pickupLocation: 'Demo pickup point at FC2',
  },
];