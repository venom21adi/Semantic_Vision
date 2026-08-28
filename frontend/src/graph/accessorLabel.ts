/** A getter and setter for the same property share a bare `label`
 * (`"value"`), by design -- `resolver/symbol_table.py` deliberately never
 * changes `label` itself, since `ts_locate`'s matching depends on it
 * staying the plain method name. Every UI render site that shows a
 * node's name to a person should go through this instead of reading
 * `label` directly, so a getter and its setter don't render as two
 * identical, indistinguishable boxes. */
export function formatNodeLabel(label: string, accessorKind?: 'get' | 'set' | null): string {
  if (accessorKind === 'get') return `get ${label}`
  if (accessorKind === 'set') return `set ${label}`
  return label
}
