const pool = require('./db');

const ALLOWED_CATEGORIES = ['Ordering', 'Payment', 'Pickup'];

function validateFaq(data) {
  const errors = {};

  if (typeof data.question !== 'string' || data.question.trim().length === 0) {
    errors.question = 'Question is required.';
  } else if (data.question.trim().length > 300) {
    errors.question = 'Question must be 300 characters or fewer.';
  }

  if (typeof data.answer !== 'string' || data.answer.trim().length === 0) {
    errors.answer = 'Answer is required.';
  } else if (data.answer.trim().length > 2000) {
    errors.answer = 'Answer must be 2000 characters or fewer.';
  }

  if (!ALLOWED_CATEGORIES.includes(data.category)) {
    errors.category = 'Category must be Ordering, Payment, or Pickup.';
  }

  if (typeof data.isPublished !== 'boolean') {
    errors.isPublished = 'Published status must be true or false.';
  }

  return errors;
}

module.exports.listPublishedFaqs = async function listPublishedFaqs(category) {
  if (category && !ALLOWED_CATEGORIES.includes(category)) {
    const error = new Error('Invalid FAQ category');
    error.statusCode = 400;
    throw error;
  }

  const params = [];
  let whereClause = 'WHERE "isPublished" = TRUE';

  if (category) {
    params.push(category);
    whereClause += ' AND "category" = $1';
  }

  const { rows } = await pool.query(
    `SELECT "id", "question", "answer", "category", "createdAt"
     FROM "FAQ"
     ${whereClause}
     ORDER BY "category", "id"`,
    params,
  );

  return rows;
};

module.exports.listAllFaqs = async function listAllFaqs() {
  const { rows } = await pool.query(
    `SELECT "id", "question", "answer", "category", "isPublished", "createdAt"
     FROM "FAQ"
     ORDER BY "category", "id"`,
  );

  return rows;
};

module.exports.createFaq = async function createFaq(data) {
  const errors = validateFaq(data);
  if (Object.keys(errors).length > 0) {
    const error = new Error('Invalid FAQ data');
    error.statusCode = 400;
    error.errors = errors;
    throw error;
  }

  const { rows } = await pool.query(
    `INSERT INTO "FAQ" ("question", "answer", "category", "isPublished")
     VALUES ($1, $2, $3, $4)
     RETURNING "id", "question", "answer", "category", "isPublished", "createdAt"`,
    [data.question.trim(), data.answer.trim(), data.category, data.isPublished],
  );

  return rows[0];
};

module.exports.updateFaq = async function updateFaq(id, data) {
  const faqId = Number(id);
  if (!Number.isInteger(faqId) || faqId <= 0) {
    const error = new Error('Invalid FAQ ID');
    error.statusCode = 400;
    throw error;
  }

  const errors = validateFaq(data);
  if (Object.keys(errors).length > 0) {
    const error = new Error('Invalid FAQ data');
    error.statusCode = 400;
    error.errors = errors;
    throw error;
  }

  const { rows } = await pool.query(
    `UPDATE "FAQ"
     SET "question" = $1,
         "answer" = $2,
         "category" = $3,
         "isPublished" = $4
     WHERE "id" = $5
     RETURNING "id", "question", "answer", "category", "isPublished", "createdAt"`,
    [data.question.trim(), data.answer.trim(), data.category, data.isPublished, faqId],
  );

  if (rows.length === 0) {
    const error = new Error('FAQ not found');
    error.statusCode = 404;
    throw error;
  }

  return rows[0];
};

module.exports.deleteFaq = async function deleteFaq(id) {
  const faqId = Number(id);
  if (!Number.isInteger(faqId) || faqId <= 0) {
    const error = new Error('Invalid FAQ ID');
    error.statusCode = 400;
    throw error;
  }

  const { rowCount } = await pool.query('DELETE FROM "FAQ" WHERE "id" = $1', [faqId]);

  if (rowCount === 0) {
    const error = new Error('FAQ not found');
    error.statusCode = 404;
    throw error;
  }

  return true;
};
