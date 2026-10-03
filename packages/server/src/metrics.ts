/**
 * Métricas mínimas no formato de exposição do Prometheus, sem dependências.
 * Suficiente para um ServiceMonitor e para alertar sobre ticks lentos.
 */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private tickCount = 0;
  private tickSumMs = 0;
  private tickMaxMs = 0;
  private readonly startedAt = Date.now();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  observeTick(ms: number): void {
    this.tickCount++;
    this.tickSumMs += ms;
    this.tickMaxMs = Math.max(this.tickMaxMs, ms);
  }

  render(gauges: Record<string, number>): string {
    const lines: string[] = [];
    const metric = (name: string, type: string, help: string, value: number) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${value}`);
    };
    metric(
      'caranguejada_uptime_seconds',
      'gauge',
      'Tempo desde o início do processo.',
      (Date.now() - this.startedAt) / 1000,
    );
    for (const [name, value] of Object.entries(gauges)) {
      metric(`caranguejada_${name}`, 'gauge', `Valor atual de ${name}.`, value);
    }
    for (const [name, value] of this.counters) {
      metric(`caranguejada_${name}_total`, 'counter', `Total de ${name}.`, value);
    }
    metric(
      'caranguejada_tick_duration_ms_sum',
      'counter',
      'Soma da duração dos ticks.',
      this.tickSumMs,
    );
    metric(
      'caranguejada_tick_duration_ms_count',
      'counter',
      'Quantidade de ticks.',
      this.tickCount,
    );
    metric(
      'caranguejada_tick_duration_ms_max',
      'gauge',
      'Maior tick desde a última coleta.',
      this.tickMaxMs,
    );
    this.tickMaxMs = 0;
    return lines.join('\n') + '\n';
  }
}
