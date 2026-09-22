import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

// Standalone and reusable — any future feature that needs to send an email
// (ADR-0021 §D.3's own eventually-planned notification channel included)
// imports this module rather than re-implementing provider integration.
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
