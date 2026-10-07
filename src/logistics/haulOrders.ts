/**
 * Durable hauler pickup reservations (Memory.ags.haulOrders).
 * Prevents two haulers racing one container when only one load is left.
 */

export interface HaulOrder {
  containerId: string;
  /** Energy reserved for this hauler's next withdraw. */
  reserved: number;
  created: number;
  /** Energy withdrawn under this order so far (for settle diagnostics). */
  withdrawn: number;
}

/** haulerName → order */
export type HaulOrderBook = Record<string, HaulOrder>;

export function availableContainerEnergy(
  containerEnergy: number,
  containerId: string,
  book: HaulOrderBook,
  exceptHauler?: string,
): number {
  let reserved = 0;
  for (const [name, order] of Object.entries(book)) {
    if (exceptHauler && name === exceptHauler) continue;
    if (order.containerId !== containerId) continue;
    reserved += Math.max(0, order.reserved - Math.max(0, order.withdrawn));
  }
  return Math.max(0, containerEnergy - reserved);
}

export function claimHaulOrder(
  book: HaulOrderBook,
  opts: {
    haulerName: string;
    containerId: string;
    freeCapacity: number;
    containerEnergy: number;
    tick: number;
  },
): HaulOrder | null {
  const available = availableContainerEnergy(
    opts.containerEnergy,
    opts.containerId,
    book,
    opts.haulerName,
  );
  const amount = Math.min(
    Math.max(0, opts.freeCapacity),
    available,
  );
  if (amount <= 0) {
    delete book[opts.haulerName];
    return null;
  }
  const prev = book[opts.haulerName];
  const order: HaulOrder = {
    containerId: opts.containerId,
    reserved: amount,
    // Keep created on same-container refresh so maxAge is not reset mid-trip.
    created:
      prev && prev.containerId === opts.containerId ? prev.created : opts.tick,
    withdrawn:
      prev && prev.containerId === opts.containerId
        ? Math.min(prev.withdrawn, amount)
        : 0,
  };
  book[opts.haulerName] = order;
  return order;
}

/** Alias: re-evaluate reservation against current store / free capacity. */
export function adjustHaulOrder(
  book: HaulOrderBook,
  opts: Parameters<typeof claimHaulOrder>[1],
): HaulOrder | null {
  return claimHaulOrder(book, opts);
}

/** Close an order after the hauler leaves the pickup (or finishes filling). */
export function settleHaulOrder(
  book: HaulOrderBook,
  haulerName: string,
  opts?: { withdrawn?: number },
): void {
  const order = book[haulerName];
  if (!order) return;
  if (opts?.withdrawn != null) {
    order.withdrawn = Math.max(0, opts.withdrawn);
  }
  delete book[haulerName];
}

export function sweepHaulOrders(
  book: HaulOrderBook,
  opts: {
    liveHaulerNames: ReadonlySet<string>;
    tick: number;
    maxAge: number;
  },
): string[] {
  const dropped: string[] = [];
  for (const name of Object.keys(book)) {
    const order = book[name];
    if (!opts.liveHaulerNames.has(name)) {
      delete book[name];
      dropped.push(name);
      continue;
    }
    if (opts.tick - order.created > opts.maxAge) {
      delete book[name];
      dropped.push(name);
    }
  }
  return dropped;
}

/** Rough one-way path + 1 intent each end. */
export function estimateHaulTripTicks(opts: {
  rangeToPickup: number;
  rangeToDropoff: number;
}): number {
  return (
    Math.max(0, opts.rangeToPickup) +
    Math.max(0, opts.rangeToDropoff) +
    2
  );
}

export function shouldAssignHaulOrder(opts: {
  ticksToLive: number | undefined;
  tripTicks: number;
  safetyMargin?: number;
}): boolean {
  if (opts.ticksToLive == null) return true;
  const margin = opts.safetyMargin ?? 10;
  return opts.ticksToLive > opts.tripTicks + margin;
}
