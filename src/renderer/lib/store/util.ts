// Keep only the newest n items. n<=0 → [] (guards against slice(-0) returning the whole array).
export const keepLast = <T>(arr: T[], n: number): T[] => (n <= 0 ? [] : arr.length > n ? arr.slice(-n) : arr);
