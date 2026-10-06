// Izvoz je odvojen od ekrana. Ovdje nema React stanja, admin dugmadi ni slanja emaila.
import type { Workbook } from "exceljs";
import { DemoState, timeLabel } from "@terapeut/domain";

/** Pravi dvije Excel tabele iz demo podataka i pokreće preuzimanje u browseru. */
export async function downloadDemoExcel(state: DemoState): Promise<void> {
  // Excel biblioteku učitavamo tek na klik, jer nije potrebna katalogu i kalendaru.
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Terapeut.me demo";
  addBookingsSheet(workbook, state);
  addHistorySheet(workbook, state);
  for (const sheet of workbook.worksheets) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }
  await downloadWorkbook(workbook);
}

/** Dodaje listu zahtjeva; jedan red predstavlja jedan zahtjev i njegov trenutni status. */
function addBookingsSheet(workbook: Workbook, state: DemoState): void {
  const sheet = workbook.addWorksheet("Zahtjevi");
  sheet.columns = [
    { header: "ID", key: "id", width: 38 },
    { header: "Klijent", key: "clientName", width: 25 },
    { header: "Email", key: "clientEmail", width: 30 },
    { header: "Telefon", key: "clientPhone", width: 20 },
    { header: "Terapeut", key: "therapist", width: 25 },
    { header: "Usluga", key: "serviceName", width: 30 },
    { header: "Datum", key: "date", width: 14 },
    { header: "Početak", key: "startLabel", width: 12 },
    { header: "Kraj", key: "endLabel", width: 12 },
    { header: "Cijena EUR", key: "price", width: 15 },
    { header: "Status", key: "status", width: 25 },
  ];
  for (const booking of state.bookings) {
    const therapist = state.therapists.find(
      (profile) => profile.id === booking.therapistId,
    );
    sheet.addRow({
      ...booking,
      therapist: therapist?.name,
      startLabel: timeLabel(booking.start),
      endLabel: timeLabel(booking.end),
    });
  }
}

/** Dodaje istoriju promjena; isti zahtjev može imati više redova. */
function addHistorySheet(workbook: Workbook, state: DemoState): void {
  const sheet = workbook.addWorksheet("Istorija");
  sheet.columns = [
    { header: "Zahtjev", key: "bookingId", width: 38 },
    { header: "Vrijeme", key: "at", width: 28 },
    { header: "Akter", key: "actor", width: 15 },
    { header: "Akcija", key: "action", width: 30 },
    { header: "Prethodni status", key: "from", width: 25 },
    { header: "Novi status", key: "to", width: 25 },
    { header: "Razlog", key: "reason", width: 40 },
    { header: "Prethodni datum", key: "previousDate", width: 18 },
    { header: "Prethodni početak", key: "previousStart", width: 18 },
  ];
  for (const booking of state.bookings) {
    for (const event of booking.events) {
      let previousStart = "";
      if (event.previousStart !== undefined) {
        previousStart = timeLabel(event.previousStart);
      }
      sheet.addRow({ bookingId: booking.id, ...event, previousStart });
    }
  }
}

/** Pretvara Excel u fajl; privremeni link služi samo za lokalno preuzimanje. */
async function downloadWorkbook(workbook: Workbook): Promise<void> {
  const bytes = await workbook.xlsx.writeBuffer();
  const file = new Blob([new Uint8Array(bytes)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const fileUrl = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = fileUrl;
  link.download = "terapeut-me-demo.xlsx";
  link.click();
  // Browseru ostavljamo vrijeme da počne preuzimanje, pa oslobađamo privremeni URL.
  window.setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
}
