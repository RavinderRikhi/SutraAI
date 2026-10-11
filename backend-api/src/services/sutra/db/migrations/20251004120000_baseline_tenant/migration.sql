-- Baseline: Tenant table already present in databases created via db push.
-- Mark this migration applied without running on existing dev DBs.

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "businessName" TEXT NOT NULL,
    "subdomainSlug" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "jsonState" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "planType" TEXT NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_subdomainSlug_key" ON "Tenant"("subdomainSlug");
