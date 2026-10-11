import {
  createPrismaClient,
  type PostgresConnectionOptions
} from "../../../lib/postgres-prisma";

export type Tenant = {
  id: string;
  businessName: string;
  subdomainSlug: string;
  contactEmail: string;
  jsonState: unknown;
  isActive: boolean;
  planType: string;
};

export type DocumentChunkInput = {
  filename: string;
  content: string;
};

export type CreateTenantInput = {
  businessName: string;
  subdomainSlug: string;
  contactEmail: string;
  planType: string;
  jsonState?: unknown;
  isActive?: boolean;
};

type TenantChunksRow = {
  chunks: DocumentChunkInput[];
};

export type DbClient = {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
  tenant: {
    findUnique(args: {
      where: { subdomainSlug: string };
      select?: { chunks: { select: { filename: true; content: true } } };
    }): Promise<Tenant | TenantChunksRow | null>;
    create(args: { data: CreateTenantInput }): Promise<Tenant>;
    update(args: {
      where: { subdomainSlug: string };
      data: { jsonState: unknown };
    }): Promise<Tenant>;
  };
  documentChunk: {
    deleteMany(args: {
      where: { tenantId: string; filename: { in: string[] } };
    }): Promise<{ count: number }>;
    createMany(args: {
      data: Array<{ tenantId: string; filename: string; content: string }>;
    }): Promise<{ count: number }>;
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
  private readonly handle: ReturnType<typeof createPrismaClient> | null;

  constructor(options: PostgresConnectionOptions, client?: DbClient) {
    if (client) {
      this.client = client;
      this.handle = null;
      return;
    }
    const handle = createPrismaClient(options);
    this.handle = handle;
    this.client = handle.client as unknown as DbClient;
  }

  async connect(): Promise<void> {
    if (this.handle) {
      await this.handle.connect();
      return;
    }
    await this.client.$connect();
  }

  disconnect(): Promise<void> {
    if (this.handle) {
      return this.handle.disconnect();
    }
    return this.client.$disconnect();
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const row = await this.client.tenant.findUnique({
      where: { subdomainSlug: slug }
    });
    if (row === null || !("id" in row)) {
      return null;
    }
    return mapTenant(row);
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

  async getTenantContextChunks(subdomainSlug: string): Promise<DocumentChunkInput[]> {
    const row = await this.client.tenant.findUnique({
      where: { subdomainSlug },
      select: {
        chunks: {
          select: {
            filename: true,
            content: true
          }
        }
      }
    });
    if (row === null || !("chunks" in row)) {
      return [];
    }
    return row.chunks;
  }

  async saveDocumentChunks(
    subdomainSlug: string,
    chunks: DocumentChunkInput[]
  ): Promise<void> {
    const tenant = await this.client.tenant.findUnique({
      where: { subdomainSlug }
    });
    if (tenant === null || !("id" in tenant)) {
      throw new Error(`Tenant not found: ${subdomainSlug}`);
    }
    if (chunks.length === 0) {
      return;
    }
    const tenantId = tenant.id;
    const filenames = [...new Set(chunks.map((c) => c.filename))];
    await this.client.$transaction(async (tx) => {
      await tx.documentChunk.deleteMany({
        where: { tenantId, filename: { in: filenames } }
      });
      await tx.documentChunk.createMany({
        data: chunks.map((c) => ({
          tenantId,
          filename: c.filename,
          content: c.content
        }))
      });
    });
  }
}
