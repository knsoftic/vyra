'use client';

import { CataloguePage } from '@/components/Catalogue';

export default function RegionsPage() {
  return (
    <CataloguePage
      title="Countries & Regions"
      subtitle="Per-country switches. Disabling a country blocks new sign-ups from it, never existing accounts."
      path="regions"
      idKey="code"
      columns={[
        { key: 'code', label: 'Code', kind: 'readonly' },
        { key: 'name', label: 'Country', kind: 'readonly' },
        { key: 'currency', label: 'Currency', kind: 'text', writeAs: 'currency' },
        { key: 'isEnabled', label: 'Enabled', kind: 'toggle', writeAs: 'is_enabled', align: 'center' },
        { key: 'adsEnabled', label: 'Ads', kind: 'toggle', writeAs: 'ads_enabled', align: 'center' },
        { key: 'businessEnabled', label: 'Business', kind: 'toggle', writeAs: 'business_enabled', align: 'center' },
        { key: 'verificationEnabled', label: 'Verification', kind: 'toggle', writeAs: 'verification_enabled', align: 'center' },
      ]}
      createLabel="Add country"
      createFields={[
        { column: 'code', label: 'Code', kind: 'string', required: true, placeholder: 'PK', help: 'two letters, ISO 3166' },
        { column: 'name', label: 'Country', kind: 'string', required: true, placeholder: 'Pakistan' },
        { column: 'currency', label: 'Currency', kind: 'string', required: true, placeholder: 'PKR' },
        { column: 'is_enabled', label: 'Enabled', kind: 'boolean' },
        { column: 'ads_enabled', label: 'Ads', kind: 'boolean' },
        { column: 'business_enabled', label: 'Business', kind: 'boolean' },
        { column: 'verification_enabled', label: 'Verification', kind: 'boolean' },
      ]}
    />
  );
}
