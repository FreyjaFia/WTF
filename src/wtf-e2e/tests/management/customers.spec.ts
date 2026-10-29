import { APIResponse } from '@playwright/test';
import { expect, test } from '@fixtures/index';
import { Api } from '@api/index';
import { ManagementExtraApi } from '@api/management-extra';
import { unique } from '@utils/unique';

const LONG_NAME: string = 'N'.repeat(101);

function mx(api: Api): ManagementExtraApi {
  return new ManagementExtraApi(api.client);
}

async function expectRejected(response: APIResponse, label: string): Promise<void> {
  expect(response.status(), `${label}: ${await response.text()}`).toBe(400);
}

test.describe('customers: create, validate, edit, delete, restore @management', () => {
  test('a valid customer is created and found by search', async ({ api }) => {
    const body = mx(api).customerBody();

    const response = await mx(api).post('customers', body);

    expect(response.status()).toBe(201);
    const created = await response.json();
    const listed = await mx(api).list(`customers?searchTerm=${encodeURIComponent(String(body.firstName))}`);
    expect(listed.map((customer) => customer.id)).toContain(created.id);
  });

  const BAD_CUSTOMERS: ReadonlyArray<{ readonly label: string; readonly change: Record<string, unknown> }> = [
    { label: 'an empty first name', change: { firstName: '' } },
    { label: 'an empty last name', change: { lastName: '' } },
    { label: 'a contact number with letters', change: { contactNumber: 'call-me-maybe' } },
    { label: 'a contact number with fewer than 7 digits', change: { contactNumber: '12345' } },
    { label: 'a contact number longer than 30 characters', change: { contactNumber: '1'.repeat(31) } },
    { label: 'a first name of 101 characters', change: { firstName: LONG_NAME } },
  ];
  for (const bad of BAD_CUSTOMERS) {
    test(`${bad.label} gives 400 and creates nothing`, async ({ api }) => {
      const marker = unique('BadCust');
      const body = mx(api).customerBody({ address: marker, ...bad.change });

      const response = await mx(api).post('customers', body);

      await expectRejected(response, bad.label);
      const created = await mx(api).list(`customers?searchTerm=${encodeURIComponent(marker)}`);
      expect(created).toHaveLength(0);
    });
  }

  test('editing a customer saves the new address and contact number', async ({ api }) => {
    const customer = await api.customers.create();

    const response = await mx(api).put(`customers/${customer.id}`, {
      id: customer.id,
      firstName: customer.firstName,
      lastName: 'Edited',
      address: '99 New Road',
      contactNumber: '+63 917 555 0100',
    });

    expect(response.ok(), await response.text()).toBeTruthy();
    const saved = await api.client.json<{ lastName: string; address: string; contactNumber: string }>('superadmin', 'GET', `customers/${customer.id}`);
    expect(saved).toMatchObject({ lastName: 'Edited', address: '99 New Road', contactNumber: '+63 917 555 0100' });
  });

  test('editing a customer with a bad contact number is refused and keeps the old one', async ({ api }) => {
    const customer = await api.customers.create();

    const response = await mx(api).put(`customers/${customer.id}`, {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      address: 'x',
      contactNumber: 'abc',
    });

    await expectRejected(response, 'bad contact on edit');
    const saved = await api.client.json<{ contactNumber: string }>('superadmin', 'GET', `customers/${customer.id}`);
    expect(saved.contactNumber).toBe('09170000000');
  });

  test('delete is a soft delete and restore brings the customer back', async ({ api }) => {
    const customer = await api.customers.create();

    await api.customers.remove(customer.id);
    expect((await mx(api).list(`customers?isActive=true&searchTerm=${customer.firstName}`)).map((c) => c.id)).not.toContain(customer.id);
    const inactive = await mx(api).list(`customers?isActive=false&searchTerm=${customer.firstName}`);
    expect(inactive.find((c) => c.id === customer.id)?.isActive).toBe(false);

    await api.client.json<unknown>('superadmin', 'POST', `customers/${customer.id}/restore`);
    expect((await mx(api).list(`customers?isActive=true&searchTerm=${customer.firstName}`)).map((c) => c.id)).toContain(customer.id);
  });
});
