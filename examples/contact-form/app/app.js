const form = document.querySelector('#contact-form');
const sent = document.querySelector('#sent');
const formError = document.querySelector('#form-error');

const fields = {
  name: { input: form.elements.name, error: document.querySelector('#name-error'), empty: 'Enter your name.' },
  email: { input: form.elements.email, error: document.querySelector('#email-error'), empty: 'Enter your email address.' },
  message: { input: form.elements.message, error: document.querySelector('#message-error'), empty: 'Enter a message.' },
};

function setError(field, text) {
  field.error.textContent = text ?? '';
  field.error.hidden = !text;
  if (text) field.input.setAttribute('aria-invalid', 'true');
  else field.input.removeAttribute('aria-invalid');
}

function validate() {
  let firstInvalid = null;
  for (const field of Object.values(fields)) {
    const value = field.input.value.trim();
    let problem = value ? null : field.empty;
    if (!problem && field === fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
      problem = 'Enter a valid email address, like name@example.com.';
    }
    setError(field, problem);
    if (problem && !firstInvalid) firstInvalid = field.input;
  }
  firstInvalid?.focus();
  return !firstInvalid;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  formError.hidden = true;
  if (!validate()) return;

  const body = Object.fromEntries(new FormData(form));
  try {
    // Note: there is no loading state while this request is in flight.
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    document.querySelector('#sent-name').textContent = body.name;
    document.querySelector('#sent-email').textContent = body.email;
    form.hidden = true;
    sent.hidden = false;
  } catch {
    formError.hidden = false;
  }
});

document.querySelector('#send-another').addEventListener('click', () => {
  form.reset();
  sent.hidden = true;
  form.hidden = false;
  fields.name.input.focus();
});
