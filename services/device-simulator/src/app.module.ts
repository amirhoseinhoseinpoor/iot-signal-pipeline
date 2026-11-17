import { Module } from '@nestjs/common';
import { loadConfig, SimulatorConfig } from './config';
import {
  defaultPublisherFactory,
  PUBLISHER_FACTORY,
  PublisherFactory,
  SIMULATOR_CONFIG,
  SimulatorService,
} from './simulator.service';

@Module({
  providers: [
    { provide: SIMULATOR_CONFIG, useFactory: () => loadConfig() },
    { provide: PUBLISHER_FACTORY, useValue: defaultPublisherFactory },
    {
      provide: SimulatorService,
      inject: [SIMULATOR_CONFIG, PUBLISHER_FACTORY],
      useFactory: (config: SimulatorConfig, factory: PublisherFactory) =>
        new SimulatorService(config, factory),
    },
  ],
})
export class AppModule {}
