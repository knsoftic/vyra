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

/** One field in the "add new" form. `column` is the snake_case column name. */
export interface CreateField {
  column: string;
  label: string;
  kind: 'string' | 'number' | 'boolean';
  required?: boolean;
  placeholder?: string;
  help?: string;
}

export function CataloguePage({
  title,
  subtitle,
  path,
  idKey = 'id',
  columns,
  cardTitle,
  cardDescription,
  createFields,
  createLabel,
  deletable,
}: {
  title: string;
  subtitle: string;
  /** The `/admin/<path>` list + patch pair. */
  path: string;
  idKey?: string;
  columns: CatalogueColumn[];
  cardTitle?: string;
  cardDescription?: string;
  createFields?: CreateField[];
  createLabel?: string;
  deletable?: boolean;
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
        {...(createFields ? { createFields } : {})}
        {...(createLabel ? { createLabel } : {})}
        {...(deletable ? { deletable } : {})}
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
  createFields,
  createLabel = 'Add new',
  deletable = false,
}: {
  path: string;
  idKey?: string;
  columns: CatalogueColumn[];
  cardTitle?: string;
  cardDescription?: string;
  /** Providing these turns on the "add new" form. */
  createFields?: CreateField[];
  createLabel?: string;
  /** Only for tables the server soft-deletes. */
  deletable?: boolean;
}) {
  const { state, reload } = useAdminData(() => adminApi.list(path), [path]);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const create = async () => {
    if (!createFields) return;
    setBusy(true);
    setError(null);
    try {
      const values: Record<string, string | number | boolean> = {};
      for (const field of createFields) {
        const raw = newRow[field.column];
        if (raw === undefined || raw === '') {
          if (field.required) throw new Error(`${field.label} is required.`);
          continue;
        }
        values[field.column] =
          field.kind === 'number' ? Number(raw) : field.kind === 'boolean' ? raw === true : String(raw);
      }
      await adminApi.create(path, values);
      setNewRow({});
      setAdding(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the row.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.remove(path, id);
      setConfirmDelete(null);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the row.');
    } finally {
      setBusy(false);
    }
  };

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
          action={
            <div className="flex items-center gap-2">
              {createFields ? (
                <Button
                  size="sm"
                  icon={adding ? 'close' : 'plus'}
                  variant={adding ? 'secondary' : 'primary'}
                  onClick={() => setAdding((open) => !open)}
                >
                  {adding ? 'Cancel' : createLabel}
                </Button>
              ) : null}
              <Button size="sm" icon="refresh" onClick={reload}>Refresh</Button>
            </div>
          }
        >
          {adding && createFields ? (
            <div className="mb-4 rounded-xl border border-brand/30 bg-brand/5 p-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {createFields.map((field) => (
                  <label key={field.column} className="block">
                    <span className="block text-[11px] text-muted mb-1">
                      {field.label}
                      {field.required ? ' *' : ''}
                    </span>
                    {field.kind === 'boolean' ? (
                      <Toggle
                        checked={newRow[field.column] === true}
                        onChange={(next) => setNewRow((prev) => ({ ...prev, [field.column]: next }))}
                      />
                    ) : (
                      <input
                        className="bg-surface-2 border border-border rounded-md px-2 py-1.5 text-xs w-full outline-none focus:border-brand"
                        placeholder={field.placeholder}
                        value={String(newRow[field.column] ?? '')}
                        onChange={(e) =>
                          setNewRow((prev) => ({ ...prev, [field.column]: e.target.value }))
                        }
                      />
                    )}
                    {field.help ? (
                      <span className="block text-[10px] text-dim mt-1">{field.help}</span>
                    ) : null}
                  </label>
                ))}
              </div>
              <div className="mt-3">
                <Button variant="primary" size="sm" onClick={() => void create()} disabled={busy}>
                  {busy ? 'Creating…' : 'Create'}
                </Button>
              </div>
            </div>
          ) : null}

          {state.data.items.length === 0 ? (
            <EmptyState icon="list" title="Nothing here yet" />
          ) : (
            <Table
              columns={[
                ...columns.map((c) => ({ label: c.label, align: c.align ?? 'left' })),
                ...(deletable ? [{ label: '', align: 'right' as const }] : []),
              ]}
            >
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
                    {deletable ? (
                      <Cell align="right">
                        {confirmDelete === id ? (
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(id)}>
                              Confirm
                            </Button>
                            <Button size="sm" onClick={() => setConfirmDelete(null)}>
                              Keep
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirmDelete(id)}>
                            Delete
                          </Button>
                        )}
                      </Cell>
                    ) : null}
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
