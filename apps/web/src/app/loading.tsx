/** Prikazuje poruku i indikator dok podaci ili stranica nijesu spremni. */
export default function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      Učitavanje / Loading…
    </div>
  );
}
