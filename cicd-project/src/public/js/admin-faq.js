const API_BASE = '/api/faqs';

const createForm = document.getElementById('create-form');
const adminFaqList = document.getElementById('admin-faq-list');
const adminMessage = document.getElementById('admin-message');

function showMessage(element, text, isError = false) {
  element.textContent = text;
  element.hidden = false;
  element.classList.toggle('message--error', isError);
}

function hideMessage(element) {
  element.hidden = true;
}

async function checkAdminSession() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Not signed in');
    await loadAdminFaqs();
  } catch {
    showMessage(adminMessage, 'Please sign in as an admin first.', true);
  }
}

async function loadAdminFaqs() {
  adminFaqList.innerHTML = '';
  hideMessage(adminMessage);

  try {
    const response = await fetch(API_BASE + '/all', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not load FAQs');
    const faqs = await response.json();

    if (!Array.isArray(faqs) || faqs.length === 0) {
      adminFaqList.textContent = 'No FAQs found.';
      return;
    }

    faqs.forEach((faq) => {
      const card = document.createElement('div');
      card.className = 'admin-card';

      const title = document.createElement('h3');
      title.textContent = faq.question;
      card.appendChild(title);

      const meta = document.createElement('p');
      meta.textContent = `Category: ${faq.category} | Published: ${faq.isPublished}`;
      card.appendChild(meta);

      const answer = document.createElement('p');
      answer.textContent = faq.answer;
      card.appendChild(answer);

      const actions = document.createElement('div');
      actions.className = 'admin-actions';

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', () => editFaq(faq));
      actions.appendChild(editButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => removeFaq(faq.id));
      actions.appendChild(deleteButton);

      card.appendChild(actions);
      adminFaqList.appendChild(card);
    });
  } catch (error) {
    showMessage(adminMessage, error.message, true);
  }
}

async function createFaq(event) {
  event.preventDefault();

  const payload = {
    question: document.getElementById('create-question').value.trim(),
    answer: document.getElementById('create-answer').value.trim(),
    category: document.getElementById('create-category').value,
    isPublished: document.getElementById('create-published').value === 'true',
  };

  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Could not create FAQ');
    }

    createForm.reset();
    await loadAdminFaqs();
    showMessage(adminMessage, 'FAQ created successfully.');
  } catch (error) {
    showMessage(adminMessage, error.message, true);
  }
}

async function editFaq(faq) {
  const question = prompt('Edit question:', faq.question);
  if (question === null) return;

  const answer = prompt('Edit answer:', faq.answer);
  if (answer === null) return;

  const category = prompt('Edit category (Ordering, Payment, Pickup):', faq.category);
  if (category === null) return;

  const publishedInput = prompt('Published? (true/false):', String(faq.isPublished));
  if (publishedInput === null) return;

  const payload = {
    question: question.trim(),
    answer: answer.trim(),
    category: category.trim(),
    isPublished: publishedInput.trim().toLowerCase() === 'true',
  };

  try {
    const response = await fetch(`${API_BASE}/${faq.id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Could not update FAQ');
    }

    await loadAdminFaqs();
    showMessage(adminMessage, 'FAQ updated successfully.');
  } catch (error) {
    showMessage(adminMessage, error.message, true);
  }
}

async function removeFaq(id) {
  const confirmed = confirm('Delete this FAQ?');
  if (!confirmed) return;

  try {
    const response = await fetch(`${API_BASE}/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Could not delete FAQ');
    }

    await loadAdminFaqs();
    showMessage(adminMessage, 'FAQ deleted successfully.');
  } catch (error) {
    showMessage(adminMessage, error.message, true);
  }
}

createForm.addEventListener('submit', createFaq);

checkAdminSession();
