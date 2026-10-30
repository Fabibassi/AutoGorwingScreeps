/**
 * Sell minerals from the terminal into public buy orders.
 *
 * Storage floor does NOT gate mineral sales — when broke, selling minerals is
 * exactly what we want (credits). Only terminal energy must cover deal costs.
 * Never sells energy.
 */

/** Keep this much energy in terminal for deal fees / sends. */
export const TERMINAL_ENERGY_FLOOR = 5_000;

/** True when the terminal can pay market.deal energy costs. */
export function marketEnergyFloorsOk(opts: {
  storageEnergy: number;
  terminalEnergy: number;
  storageFloor?: number;
  terminalFloor?: number;
}): boolean {
  const terminalFloor = opts.terminalFloor ?? TERMINAL_ENERGY_FLOOR;
  return opts.terminalEnergy >= terminalFloor;
}

const ENERGY_RESOURCES = new Set<string>(["energy"]);

/** Non-energy resources sitting in terminal (minerals / compounds). */
export function terminalMineralTypes(
  store: { [key: string]: number | undefined } | StoreDefinition,
): ResourceConstant[] {
  const out: ResourceConstant[] = [];
  for (const key of Object.keys(store)) {
    if (ENERGY_RESOURCES.has(key)) continue;
    const amount = store[key as ResourceConstant] ?? 0;
    if (amount > 0) out.push(key as ResourceConstant);
  }
  return out;
}

/**
 * One deal attempt per tick when floors allow. Pure selection helpers stay
 * testable; Game.market calls stay in the room runner.
 */
export function pickMineralSellDeal(opts: {
  resource: ResourceConstant;
  amount: number;
  orders: Array<{
    id: string;
    type: string;
    resourceType: string;
    remainingAmount: number;
    price: number;
    roomName?: string;
  }>;
  minPrice?: number;
}): { orderId: string; amount: number } | null {
  const minPrice = opts.minPrice ?? 0.001;
  const buyType = typeof ORDER_BUY !== "undefined" ? ORDER_BUY : "buy";
  const buys = opts.orders
    .filter(
      (o) =>
        (o.type === buyType || o.type === "buy") &&
        o.resourceType === opts.resource &&
        o.remainingAmount > 0 &&
        o.price >= minPrice,
    )
    .sort((a, b) => b.price - a.price);
  const best = buys[0];
  if (!best) return null;
  const amount = Math.min(opts.amount, best.remainingAmount, 1000);
  if (amount <= 0) return null;
  return { orderId: best.id, amount };
}

export function runMarket(room: Room): void {
  const terminal = room.terminal;
  if (!terminal) return;
  if (
    !marketEnergyFloorsOk({
      storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
      terminalEnergy: terminal.store[RESOURCE_ENERGY] ?? 0,
    })
  ) {
    return;
  }

  const minerals = terminalMineralTypes(terminal.store);
  if (minerals.length === 0) return;

  for (const resource of minerals) {
    const amount = terminal.store[resource] ?? 0;
    if (amount <= 0) continue;
    let orders: Array<{
      id: string;
      type: string;
      resourceType: string;
      remainingAmount: number;
      price: number;
      roomName?: string;
    }> = [];
    try {
      orders = Game.market.getAllOrders({
        type: ORDER_BUY,
        resourceType: resource,
      }) as typeof orders;
    } catch {
      return;
    }
    const deal = pickMineralSellDeal({ resource, amount, orders });
    if (!deal) continue;
    const result = Game.market.deal(deal.orderId, deal.amount, room.name);
    if (result === OK) return;
  }
}
