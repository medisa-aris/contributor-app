import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module';
import { MindMapController } from './mind-map.controller';
import { MindMapService } from './mind-map.service';

@Module({
  imports: [RbacModule],
  controllers: [MindMapController],
  providers: [MindMapService],
})
export class MindMapModule {}
