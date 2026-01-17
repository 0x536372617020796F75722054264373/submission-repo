export function add(a: string | number, b: string | number): string {
  return (parseFloat(a.toString()) + parseFloat(b.toString())).toString();
}

export function subtract(a: string | number, b: string | number): string {
  return (parseFloat(a.toString()) - parseFloat(b.toString())).toString();
}

export function multiply(a: string | number, b: string | number): string {
  return (parseFloat(a.toString()) * parseFloat(b.toString())).toString();
}

export function divide(a: string | number, b: string | number): string {
  const divisor = parseFloat(b.toString());
  if (divisor === 0) throw new Error('Division by zero');
  return (parseFloat(a.toString()) / divisor).toString();
}

export function abs(a: string | number): string {
  return Math.abs(parseFloat(a.toString())).toString();
}

export function min(a: string | number, b: string | number): string {
  return Math.min(parseFloat(a.toString()), parseFloat(b.toString())).toString();
}

export function max(a: string | number, b: string | number): string {
  return Math.max(parseFloat(a.toString()), parseFloat(b.toString())).toString();
}

export function isZero(a: string | number): boolean {
  return parseFloat(a.toString()) === 0;
}

export function isPositive(a: string | number): boolean {
  return parseFloat(a.toString()) > 0;
}

export function isNegative(a: string | number): boolean {
  return parseFloat(a.toString()) < 0;
}

export function compare(a: string | number, b: string | number): number {
  const diff = parseFloat(a.toString()) - parseFloat(b.toString());
  if (diff > 0) return 1;
  if (diff < 0) return -1;
  return 0;
}
