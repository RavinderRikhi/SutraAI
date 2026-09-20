import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  buildPostgresUrl,
  type PostgresConnectionOptions
} from "./options";

export type Tenant = {
  id: string;
  businessName: string;
  subdomainSlug: string;
  contactEmail: string;
  jsonState: unknown;
  isActive: boolean;
  planType: string;
};

export type CreateTenantInput = {
  businessName: string;
  subdomainSlug: string;
  contactEmail: string;
  planType: string;
  jsonState?: unknown;
  isActive?: boolean;
};

export type DbClient = {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  tenant: {
    findUnique(args: { where: { subdomainSlug: string } }): Promise<Tenant | null>;
    create(args: { data: CreateTenantInput }): Promise<Tenant>;
    update(args: {
      where: { subdomainSlug: string };
      data: { jsonState: unknown };
    }): Promise<Tenant>;
  };
};

function mapTenant(row: Tenant): Tenant {
  return {
    id: row.id,
    businessName: row.businessName,
    subdomainSlug: row.subdomainSlug,
    contactEmail: row.contactEmail,
    jsonState: row.jsonState,
    isActive: row.isActive,
    planType: row.planType
  };
}

export class DbService {
  private readonly client: DbClient;

  constructor(options: PostgresConnectionOptions, client?: DbClient) {
    if (client) {
      this.client = client;
      return;
    }
    const adapter = new PrismaPg(buildPostgresUrl(options));
    this.client = new PrismaClient({ adapter }) as unknown as DbClient;
  }

  connect(): Promise<void> {
    return this.client.$connect();
  }

  disconnect(): Promise<void> {
    return this.client.$disconnect();
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.client.tenant.findUnique({
      where: { subdomainSlug: slug }
    });
    return row === null ? null : mapTenant(row);
  }

  async createTenant(data: CreateTenantInput): Promise<Tenant> {
    const row = await this.client.tenant.create({ data });
    return mapTenant(row);
  }

  async updateTenantState(slug: string, jsonState: unknown): Promise<Tenant> {
    const row = await this.client.tenant.update({
      where: { subdomainSlug: slug },
      data: { jsonState }
    });
    return mapTenant(row);
  }
}
