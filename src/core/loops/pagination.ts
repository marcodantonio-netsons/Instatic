/** A native loop's originating URL owns its initial page selection. */
export function loopPageQueryKey(nodeId: string): string { return `loop_${nodeId}_page` }
