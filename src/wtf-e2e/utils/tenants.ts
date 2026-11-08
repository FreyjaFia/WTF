import { APIRequestContext } from '@playwright/test';
import { CreatedShop, PlatformApi, PlatformUser, ShopInput } from '@api/platform';
import { ShopSession } from '@api/shop-session';

export interface TestShop {
  readonly created: CreatedShop;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly ownerUsername: string;
  readonly ownerPassword: string;
  readonly owner: ShopSession;
}

// A new shop made the way the platform page makes it, with its owner already signed in through the API.
export async function openShop(request: APIRequestContext, platform: PlatformApi, input: ShopInput = {}): Promise<TestShop> {
  const created = await platform.createShop(input);
  const owner = await ShopSession.signIn(request, created.ownerUsername, created.temporaryPassword);
  return {
    created,
    id: created.tenant.id,
    name: created.tenant.name,
    slug: created.tenant.slug,
    ownerUsername: created.ownerUsername,
    ownerPassword: created.temporaryPassword,
    owner,
  };
}

export async function ownerOf(platform: PlatformApi, shop: TestShop): Promise<PlatformUser> {
  const people = await platform.users(shop.id);
  const owner = people.find((person) => person.username === shop.ownerUsername);
  if (!owner) {
    throw new Error(`The owner ${shop.ownerUsername} is not in the people list of ${shop.slug}.`);
  }

  return owner;
}
