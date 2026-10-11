'use client';

import { useCallback, useEffect, useState } from 'react';

type StockItem = { id: number; name: string; available: boolean; stock_quantity: number | null };

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Kitchen stock request failed.');
  return data as T;
}

export default function KitchenInventory() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadItems = useCallback(async () => {
    try {
      const data = await readResponse<{ items: StockItem[] }>(await fetch('/api/admin/kitchen/inventory', { cache: 'no-store' }));
      setItems(data.items);
      setDrafts(Object.fromEntries(data.items.map((item) => [item.id, item.stock_quantity === null ? '' : String(item.stock_quantity)])));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load kitchen stock.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void loadItems();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadItems(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadItems]);

  async function saveStock(item: StockItem) {
    const value = drafts[item.id] ?? '';
    const stockQuantity = value.trim() === '' ? null : Number(value);
    setBusyId(item.id); setError(''); setMessage('');
    try {
      await readResponse(await fetch('/api/admin/kitchen/inventory', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, stockQuantity }),
      }));
      setMessage(`${item.name} stock updated.`);
      await loadItems();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update item stock.');
    } finally { setBusyId(null); }
  }

  return (
    <section className="admin-panel kitchen-inventory" aria-labelledby="kitchen-inventory-title">
      <div className="admin-panel-heading"><div><p className="eyebrow">MENU STOCK</p><h2 id="kitchen-inventory-title">Update item counts</h2><p className="muted">Orders reduce tracked stock automatically. Set an item to zero to mark it out of stock.</p></div><button className="admin-refresh" type="button" onClick={() => void loadItems()} disabled={loading}>↻ Refresh stock</button></div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {message && <p className="admin-success" role="status">{message}</p>}
      {loading ? <p className="muted">Loading menu stock…</p> : items.length === 0 ? <p className="muted">No menu items are available.</p> : <div className="kitchen-stock-list">
        {items.map((item) => <div className="kitchen-stock-row" key={item.id}>
          <div><strong>{item.name}</strong><small>{!item.available ? 'Hidden from customers' : item.stock_quantity === null ? 'Stock not tracked' : item.stock_quantity === 0 ? 'Out of stock' : `${item.stock_quantity} in stock`}</small></div>
          <label><span className="sr-only">Stock quantity for {item.name}</span><input type="number" min="0" max="1000000" step="1" value={drafts[item.id] ?? ''} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Untracked" /></label>
          <button className="btn" type="button" onClick={() => void saveStock(item)} disabled={busyId === item.id}>{busyId === item.id ? 'Saving…' : 'Save count'}</button>
        </div>)}
      </div>}
    </section>
  );
}
