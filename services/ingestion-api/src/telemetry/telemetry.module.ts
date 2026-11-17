import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Alert, AlertSchema } from './alert.schema';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { detectionProviders } from './detection-rules.provider';
import { DevicesController } from './devices.controller';
import { LiveEvents } from './live-events';
import { StreamController } from './stream.controller';
import { TelemetryBatch, TelemetryBatchSchema } from './telemetry-batch.schema';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TelemetryBatch.name, schema: TelemetryBatchSchema },
      { name: Alert.name, schema: AlertSchema },
    ]),
  ],
  controllers: [TelemetryController, DevicesController, AlertsController, StreamController],
  providers: [TelemetryService, AlertsService, LiveEvents, ...detectionProviders],
  exports: [TelemetryService],
})
export class TelemetryModule {}
