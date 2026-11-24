import { expect, flow, scenario } from 'specsheet';

flow(
  'Contact form',
  {
    states: {
      'help/contact': ['ready', 'invalid-email', 'sending', 'sent', 'send-failed'],
    },
  },
  () => {
    scenario('Message is sent', { covers: ['R1', 'R3'] }, async ({ page, step }) => {
      await step('Given I am on the Help page', { screen: 'help/contact', state: 'ready' }, async () => {
        await page.goto('/help');
        await expect(page.getByRole('heading', { name: 'Contact us' })).toBeVisible();
      });

      await step('When I send a message with my name, email and text', { screen: 'help/contact', state: 'sent', decision: 'Can the message be sent?', answer: 'Yes' }, async () => {
        await page.getByLabel('Name').fill('Sam Rivera');
        await page.getByLabel('Email').fill('sam@example.com');
        await page.getByLabel('Message').fill('How do I export my projects?');
        await page.getByRole('button', { name: 'Send message' }).click();
      });

      await step('Then I see a confirmation that my message was sent', { screen: 'help/contact', state: 'sent' }, async () => {
        await expect(page.getByRole('status')).toContainText('Message sent');
        await expect(page.getByRole('status')).toContainText('sam@example.com');
      });
    });

    scenario('Invalid email is rejected', { covers: ['R2'] }, async ({ page, step }) => {
      await step('Given I am on the Help page', { screen: 'help/contact', state: 'ready' }, async () => {
        await page.goto('/help');
        await expect(page.getByRole('heading', { name: 'Contact us' })).toBeVisible();
      });

      await step('When I send a message with an email that has no @', { screen: 'help/contact', state: 'invalid-email', decision: 'Can the message be sent?', answer: 'Email not valid' }, async () => {
        await page.getByLabel('Name').fill('Sam Rivera');
        await page.getByLabel('Email').fill('sam.example.com');
        await page.getByLabel('Message').fill('How do I export my projects?');
        await page.getByRole('button', { name: 'Send message' }).click();
      });

      await step('Then I see an error under the email field and nothing is sent', { screen: 'help/contact', state: 'invalid-email' }, async () => {
        await expect(page.getByText('Enter a valid email address')).toBeVisible();
        await expect(page.getByLabel('Email')).toBeFocused();
        await expect(page.getByRole('status')).toBeHidden();
      });
    });

    scenario('Sending fails', { covers: ['R4'] }, async ({ page, step }) => {
      await step('Given I am on the Help page', { screen: 'help/contact', state: 'ready' }, async () => {
        await page.goto('/help');
        await expect(page.getByRole('heading', { name: 'Contact us' })).toBeVisible();
      });

      await step('When I send a valid message while the server is down', { screen: 'help/contact', state: 'send-failed', decision: 'Can the message be sent?', answer: 'Server fails' }, async () => {
        await page.route('**/api/contact', (route) => route.fulfill({ status: 500, body: 'Server error' }));
        await page.getByLabel('Name').fill('Sam Rivera');
        await page.getByLabel('Email').fill('sam@example.com');
        await page.getByLabel('Message').fill('How do I export my projects?');
        await page.getByRole('button', { name: 'Send message' }).click();
      });

      await step('Then I see that sending failed and my message is still there', { screen: 'help/contact', state: 'send-failed' }, async () => {
        await expect(page.getByText("We couldn't send your message.")).toBeVisible();
        await expect(page.getByLabel('Message')).toHaveValue('How do I export my projects?');
        await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
      });
    });
  },
);
