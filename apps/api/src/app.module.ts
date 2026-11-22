// NestJS modul je spisak dijelova aplikacije koje treba uključiti.
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { DatabaseService } from "./database.service";
import { AuthController, AuthOriginGuard } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { EmailService } from "./auth/email.service";
import { PasswordResetService } from "./auth/password-reset.service";
import {
  DirectoryController,
  OwnPhotosController,
  PublicPhotosController,
  PhotoSessionGuard,
} from "./directory/directory.controller";
import { DirectoryService } from "./directory/directory.service";
import { PhotosService } from "./directory/photos.service";
import { BookingController } from "./bookings/booking.controller";
import { BookingService } from "./bookings/booking.service";
import { BookingRepository } from "./bookings/booking.repository";
import { BookingNotificationService } from "./notifications/booking-notification.service";
import { RecurringBookingService } from "./bookings/recurring-booking.service";
import { RecurringBookingController } from "./bookings/recurring-booking.controller";
import { WaitlistService } from "./bookings/waitlist.service";
import { WaitlistController } from "./bookings/waitlist.controller";
import {
  MaterialsController,
  MaterialsSessionGuard,
} from "./materials/materials.controller";
import { MaterialsService } from "./materials/materials.service";
import { AnalyticsController } from "./analytics/analytics.controller";
import { AnalyticsService } from "./analytics/analytics.service";
import { TherapistNotesController } from "./notes/therapist-notes.controller";
import { TherapistNotesService } from "./notes/therapist-notes.service";
import { SessionRatingController } from "./bookings/session-rating.controller";
import { SessionRatingService } from "./bookings/session-rating.service";
import { DailyService } from "./online-sessions/daily.service";
import { OnlineLobbyService } from "./online-sessions/online-lobby.service";
import { OnlineSessionsService } from "./online-sessions/online-sessions.service";
import { OnlineSessionsController } from "./online-sessions/online-sessions.controller";

// Auth, raspored i rezervacije koriste bazu i zajednička poslovna pravila.
@Module({
  controllers: [
    HealthController,
    AuthController,
    DirectoryController,
    OwnPhotosController,
    PublicPhotosController,
    BookingController,
    RecurringBookingController,
    WaitlistController,
    MaterialsController,
    AnalyticsController,
    TherapistNotesController,
    SessionRatingController,
    OnlineSessionsController,
  ],
  providers: [
    DatabaseService,
    AuthService,
    EmailService,
    PasswordResetService,
    AuthOriginGuard,
    DirectoryService,
    PhotosService,
    PhotoSessionGuard,
    BookingService,
    BookingRepository,
    BookingNotificationService,
    RecurringBookingService,
    WaitlistService,
    MaterialsService,
    MaterialsSessionGuard,
    AnalyticsService,
    TherapistNotesService,
    SessionRatingService,
    DailyService,
    OnlineLobbyService,
    OnlineSessionsService,
  ],
})
export class AppModule {}
