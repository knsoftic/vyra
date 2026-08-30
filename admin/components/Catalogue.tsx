'use client';

/**
 * The generic catalogue editor.
 *
 * Half the admin panel is the same screen: a table of configuration rows where
 * an operator flips a switch or corrects a number. This renders that screen
 * once, against the allow-listed `PATCH /admin/<path>/:id` editors on the
 * server — toggles save on flip, text and number cells save on blur, and every
 * save is audited server-side.
 */

import { useState } from 'react';
import {
  PageHeader, SectionCard, Button, Badge, Table, Row, Cell,
  EmptyState, Notice, Toggle, Tone,
} from '@/components/ui';
import { adminApi, type CatalogueRow } from '@/lib/api';
import { useAdminData } from '@/lib/useAdminData';

export interface CatalogueColumn {
  /** Field name in the row as the API returns it (camelCase). */
  key: string;
  label: string;
  kind: 'readonly' | 'text' | 'number' | 'toggle' | 'badge';
  /** Column name to write back (snake_case); its presence makes the cell editable. */
  writeAs?: string;
  tone?: (value: unknown) => Tone;
  align?: 'left' | 'right' | 'center';
}

export function CataloguePage({
  title,
  subtitle,
  path,
  idKey = 'id',
  columns,
  cardTitle,
  cardDescription,
}: {
  title: string;
  subtitle: string;
  /** The `/admin/<path>` list + patch pair. */
  path: string;
  idKey?: string;
  columns: CatalogueColumn[];
  cardTitle?: string;
  cardDescription?: string;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <CatalogueSection
        path={path}
        idKey={idKey}
        columns={columns}
        cardTitle={cardTitle}
        cardDescription={cardDescription}
      />
    </>
  );
}

/** The card alone, so composite pages can stack several catalogues. */
export function CatalogueSection({
  path,
  idKey = 'id',
  columns,
  cardTitle,
  cardDescription,
}: {
  path: string;
  idKey?: string;
  columns: CatalogueColumn[];
  cardTitle?: string;
  cardDescription?: string;
}) {
  const { state, reload } = useAdminData(() => adminApi.list(path), [path]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = async (id: string | number, column: string, value: string | number | boolean) => {
    setError(null);
    try {
      await adminApi.update(path, id, { [column]: value });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
      reload();
    }
  };

  return (
    <>
      {error ? <div className="mb-4"><Notice tone="danger" title="Save failed">{error}</Notice></div> : null}
      {state.status === 'offline' ? (
        <Notice tone="danger" title="Cannot reach the API">{state.message}</Notice>
      ) : null}

      {state.status === 'live' ? (
        <SectionCard
          title={cardTitle ?? `${state.data.items.length} rows`}
          description={cardDescription ?? 'Toggles save when flipped; numbers and text save when you leave the field. Every change is audited.'}
          action={<Button size="sm" icon="refresh" onClick={reload}>Refresh</Button>}
        >
          {state.data.items.length === 0 ? (
            <EmptyState icon="list" title="Nothing here yet" />
          ) : (
            <Table columns={columns.map((c) => ({ label: c.label, align: c.align ?? 'left' }))}>
              {state.data.items.map((row) => {
                const id = String(row[idKey as keyof CatalogueRow] ?? '');
                return (
                  <Row key={id}>
                    {columns.map((column) => {
                      const value = row[column.key as keyof CatalogueRow];
                      const draftKey = `${id}.${column.key}`;

                      if (column.kind === 'toggle' && column.writeAs) {
                        return (
                          <Cell key={column.key} align={column.align}>
                            <Toggle
                              checked={value === 1 || value === true}
                              onChange={(next) => void save(id, column.writeAs!, next)}
                            />
                          </Cell>
                        );
                      }

                      if ((column.kind === 'text' || column.kind === 'number') && column.writeAs) {
                        return (
                          <Cell key={column.key} align={column.align}>
                            <input
                              className="bg-surface-2 border border-border rounded-md px-2 py-1 text-xs w-full min-w-[70px] outline-none focus:border-brand tnum"
                              value={drafts[draftKey] ?? String(value ?? '')}
                              onChange={(e) => setDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                              onBlur={() => {
                                const draft = drafts[draftKey];
                                if (draft === undefined || draft === String(value ?? '')) return;
                                void save(
                                  id,
                                  column.writeAs!,
                                  column.kind === 'number' ? Number(draft) : draft,
                                );
                              }}
                            />
                          </Cell>
                        );
                      }

                      if (column.kind === 'badge') {
                        return (
                          <Cell key={column.key} align={column.align}>
                            <Badge tone={column.tone ? column.tone(value) : 'neutral'}>{String(value ?? '—')}</Badge>
                          </Cell>
                        );
                      }

                      return (
                        <Cell key={column.key} align={column.align} className="text-muted">
                          {String(value ?? '—')}
                        </Cell>
                      );
                    })}
                  </Row>
                );
              })}
            </Table>
          )}
        </SectionCard>
      ) : null}
    </>
  );
}
