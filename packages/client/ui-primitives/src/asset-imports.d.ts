/** Build-owned Worker source embedded in the library by `tsdown.config.ts`. */
declare module '*.ts?raw' {
  const source: string
  export default source
}
