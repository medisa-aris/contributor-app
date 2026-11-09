export type GuardrailGroup = 'specific' | 'general' | 'consumer' | 'other';

export interface GuardrailCategory {
  id: string;
  group: GuardrailGroup;
  label: string;
  /** Nama kolom/kunci (huruf kecil, dipisah `_`) yang menandakan kategori ini. */
  columns: readonly string[];
}

/**
 * Jenis data pribadi yang dilindungi Guardrails. Disusun dari UU 27/2022 Pasal 4 (spesifik dan
 * umum) dan POJK 22/2023 Pasal 19 (data konsumen perseorangan); perlu ditinjau tim legal.
 */
export const GUARDRAIL_CATEGORIES: readonly GuardrailCategory[] = [
  {
    id: 'health',
    group: 'specific',
    label: 'Data dan informasi kesehatan',
    columns: ['kesehatan', 'diagnosa', 'diagnosis', 'penyakit', 'riwayat_penyakit', 'riwayat_medis', 'rekam_medis', 'medical_record', 'golongan_darah', 'blood_type', 'alergi', 'disabilitas', 'hasil_lab'],
  },
  {
    id: 'biometric',
    group: 'specific',
    label: 'Data biometrik',
    columns: ['biometrik', 'biometric', 'sidik_jari', 'fingerprint', 'retina', 'iris', 'face_id', 'foto_wajah', 'rekam_wajah', 'data_wajah'],
  },
  {
    id: 'genetic',
    group: 'specific',
    label: 'Data genetika',
    columns: ['genetika', 'genetik', 'genetic', 'dna', 'genom', 'genome'],
  },
  {
    id: 'criminal',
    group: 'specific',
    label: 'Catatan kejahatan',
    columns: ['catatan_kejahatan', 'catatan_kriminal', 'criminal_record', 'skck', 'riwayat_pidana', 'vonis'],
  },
  {
    id: 'child',
    group: 'specific',
    label: 'Data anak',
    columns: ['nama_anak', 'data_anak', 'child_name', 'anak'],
  },
  {
    id: 'financial',
    group: 'specific',
    label: 'Data keuangan pribadi',
    columns: ['gaji', 'salary', 'upah', 'penghasilan', 'pendapatan', 'income', 'rekening', 'no_rekening', 'nomor_rekening', 'no_rek', 'norek', 'account_number', 'saldo', 'balance', 'hutang', 'utang', 'limit_kredit', 'skor_kredit', 'credit_score', 'npwp', 'tax_id', 'no_kartu', 'nomor_kartu', 'card_number', 'cvv', 'pin'],
  },
  {
    id: 'full_name',
    group: 'general',
    label: 'Nama lengkap',
    columns: ['nama', 'name', 'nama_lengkap', 'full_name', 'fullname', 'first_name', 'last_name', 'nama_depan', 'nama_belakang', 'nama_panggilan', 'nickname', 'username', 'karyawan', 'pegawai', 'nasabah', 'pelanggan', 'konsumen', 'customer', 'employee'],
  },
  {
    id: 'gender',
    group: 'general',
    label: 'Jenis kelamin',
    columns: ['jenis_kelamin', 'kelamin', 'gender', 'sex', 'jk'],
  },
  {
    id: 'nationality',
    group: 'general',
    label: 'Kewarganegaraan',
    columns: ['kewarganegaraan', 'warga_negara', 'nationality', 'citizenship', 'wn'],
  },
  {
    id: 'religion',
    group: 'general',
    label: 'Agama',
    columns: ['agama', 'religion', 'kepercayaan'],
  },
  {
    id: 'marital_status',
    group: 'general',
    label: 'Status perkawinan',
    columns: ['status_perkawinan', 'status_pernikahan', 'status_nikah', 'status_kawin', 'marital_status'],
  },
  {
    id: 'nik',
    group: 'consumer',
    label: 'NIK dan nomor identitas',
    columns: ['nik', 'nomor_induk_kependudukan', 'ktp', 'no_ktp', 'nomor_ktp', 'kk', 'no_kk', 'nomor_kk', 'paspor', 'passport', 'no_paspor', 'nomor_paspor', 'sim', 'no_sim', 'national_id', 'ssn'],
  },
  {
    id: 'address',
    group: 'consumer',
    label: 'Alamat',
    columns: ['alamat', 'address', 'alamat_rumah', 'alamat_ktp', 'domisili', 'kode_pos', 'postal_code', 'zip', 'street', 'jalan'],
  },
  {
    id: 'birth_date',
    group: 'consumer',
    label: 'Tanggal lahir dan umur',
    columns: ['tanggal_lahir', 'tgl_lahir', 'tempat_lahir', 'tempat_tanggal_lahir', 'ttl', 'dob', 'date_of_birth', 'birth_date', 'birthdate', 'umur', 'usia', 'age'],
  },
  {
    id: 'phone',
    group: 'consumer',
    label: 'Nomor telepon',
    columns: ['telepon', 'telp', 'tlp', 'no_telp', 'no_tlp', 'no_telepon', 'nomor_telepon', 'no_hp', 'nomor_hp', 'hp', 'handphone', 'phone', 'phone_number', 'mobile', 'ponsel', 'whatsapp', 'wa'],
  },
  {
    id: 'mother_name',
    group: 'consumer',
    label: 'Nama ibu kandung',
    columns: ['nama_ibu', 'ibu_kandung', 'nama_ibu_kandung', 'mother_name', 'mothers_maiden_name', 'maiden_name'],
  },
  {
    id: 'email',
    group: 'other',
    label: 'Alamat email',
    columns: ['email', 'e_mail', 'surel', 'alamat_email', 'mail'],
  },
  {
    id: 'password',
    group: 'other',
    label: 'Kata sandi',
    columns: ['password', 'passwd', 'pwd', 'kata_sandi', 'sandi', 'api_key', 'secret'],
  },
];

export const GUARDRAIL_CATEGORY_IDS: readonly string[] = GUARDRAIL_CATEGORIES.map((c) => c.id);

export const GUARDRAIL_LIMITS = {
  maxTerms: 1000,
  maxTermLength: 100,
} as const;

export interface GuardrailSettingsDto {
  enabled: boolean;
  blockImages: boolean;
  categories: string[];
  terms: string[];
  /** false bila GUARDRAILS_SECRET_KEY belum diatur; Guardrails tidak bisa diaktifkan. */
  keyConfigured: boolean;
}
