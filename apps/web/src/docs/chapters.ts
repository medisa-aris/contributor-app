import type { DocChapter } from './types';

const img = (chapter: string, file: string) => `/docs/${chapter}/${file}.jpg`;

export const DOC_CHAPTERS: DocChapter[] = [
  {
    id: 'memulai',
    hub: 'start',
    title: 'Memulai ContributorAI',
    summary:
      'Masuk ke aplikasi, mengenali Beranda, berpindah menu, mencari apa saja dengan Ctrl/⌘ K, memantau notifikasi, dan mengatur tampilan.',
    audience: 'Semua pengguna',
    permissions: [],
    steps: [
      {
        title: 'Buka halaman masuk',
        body: [
          'Buka alamat ContributorAI yang diberikan tim TI. Halaman masuk menampilkan ringkasan manfaat aplikasi di sisi kiri dan formulir masuk di sisi kanan.',
          'Semua halaman, termasuk panduan ini, hanya dapat dibuka setelah Anda masuk.',
        ],
        image: img('01-memulai', '01-halaman-masuk'),
        result: 'Formulir masuk tampil dengan kolom Email dan Kata sandi.',
      },
      {
        title: 'Isi email dan kata sandi perusahaan',
        body: [
          'Ketik email perusahaan dan kata sandi Anda, lalu tekan Masuk atau Enter. Ikon mata di kolom kata sandi menampilkan isian bila Anda ingin memeriksanya.',
        ],
        image: img('01-memulai', '02-isi-kredensial'),
        result: 'Tombol Masuk aktif setelah kedua kolom terisi.',
        tip: 'Akun terkunci sementara bila kata sandi salah berulang kali. Lupa kata sandi? Hubungi administrator.',
      },
      {
        title: 'Kenali Beranda',
        body: [
          'Beranda merangkum pekerjaan AI Anda: tugas Subordinate yang selesai, jumlah dokumen pengetahuan, agen aktif, dan persetujuan yang menunggu.',
          'Kartu "Sorotan terbaru" menampilkan aktivitas terakhir; klik kartu di belakang untuk menampilkannya. "Pusat aplikasi" membuka setiap modul, dan "Percakapan terbaru" membuka percakapan terakhir Anda.',
        ],
        image: img('01-memulai', '03-beranda'),
        result: 'Anda melihat ringkasan pekerjaan dan pintasan ke semua modul yang boleh Anda akses.',
        tip: 'Kartu KPI hanya tampil untuk modul yang sesuai dengan izin akses Anda.',
      },
      {
        title: 'Berpindah menu lewat panel kiri',
        body: [
          'Panel kiri dikelompokkan per pusat aplikasi. Klik nama pusat untuk membuka atau menutup daftar menunya; pusat yang sedang Anda buka otomatis terbuka.',
          'Tombol panah di kaki panel menciutkan panel menjadi deretan ikon agar area kerja lebih lebar.',
        ],
        image: img('01-memulai', '04-sidebar-akordeon'),
        result: 'Menu aktif ditandai latar hijau muda dan garis vertikal di sebelah kirinya.',
      },
      {
        title: 'Cari apa saja dengan Ctrl/⌘ K',
        body: [
          'Tekan Ctrl K (Windows) atau ⌘ K (Mac), atau klik kotak "Cari menu…" di bagian atas. Ketik kata kunci untuk mencari menu, percakapan Multi Brain dan Partner, tugas Subordinate, serta agen pribadi Anda.',
          'Gunakan panah atas/bawah untuk memilih dan Enter untuk membuka.',
        ],
        image: img('01-memulai', '05-pencarian-spotlight'),
        result: 'Hasil dikelompokkan per jenis. Memilih percakapan atau tugas langsung membukanya.',
      },
      {
        title: 'Pantau notifikasi',
        body: [
          'Ikon lonceng menampilkan jumlah notifikasi baru: tugas yang selesai atau gagal, tugas yang perlu tindakan Anda, persetujuan yang menunggu, dan dokumen yang gagal diindeks.',
          'Klik notifikasi untuk langsung menuju halaman terkait, atau "Tandai sudah dibaca" untuk mengosongkan penanda.',
        ],
        image: img('01-memulai', '06-notifikasi'),
        result: 'Daftar notifikasi terbaru tampil; yang belum dibaca berlatar hijau muda.',
      },
      {
        title: 'Atur tema terang atau gelap',
        body: ['Klik ikon setengah lingkaran di header, lalu pilih Terang, Gelap, atau Ikuti sistem.'],
        image: img('01-memulai', '07-menu-tema'),
        result: 'Tampilan langsung berganti dan pilihan Anda diingat di peramban ini.',
      },
      {
        title: 'Contoh tampilan tema gelap',
        body: ['Seluruh warna, kartu, dan grafik menyesuaikan tema gelap tanpa mengubah tata letak.'],
        image: img('01-memulai', '08-tema-gelap'),
        result: 'Beranda tampil dengan latar gelap dan aksen hijau yang tetap terbaca.',
      },
      {
        title: 'Buka menu profil dan panduan',
        body: [
          'Klik nama Anda di kanan atas. Dari sini Anda dapat membuka Sistem Desain, panduan ini (Docs), atau keluar dari aplikasi.',
        ],
        image: img('01-memulai', '09-menu-profil'),
        result: 'Menu profil terbuka dengan pilihan Sistem Desain, Docs, dan Keluar.',
      },
    ],
  },
  {
    id: 'multi-brain',
    hub: 'workspace',
    title: 'Bertanya pengetahuan perusahaan — Multi Brain',
    summary:
      'Ajukan pertanyaan seputar kebijakan, proses, dan dokumen perusahaan. AI menyusun jawaban, dapat membuat dokumen, dan setiap percakapan tersimpan untuk dibuka kembali.',
    audience: 'Karyawan yang membutuhkan jawaban cepat tentang kebijakan dan proses kerja',
    permissions: ['ai.secondbrain.query'],
    steps: [
      {
        title: 'Buka Multi Brain dan mulai percakapan baru',
        body: [
          'Pilih Ruang Kerja AI › Multi Brain. Halaman terbagi tiga: daftar percakapan di kiri, area percakapan di tengah, dan panel lampiran di kanan.',
          'Percakapan baru menampilkan contoh pertanyaan yang bisa langsung dipakai.',
        ],
        image: img('02-multi-brain', '01-percakapan-baru'),
        result: 'Area tengah menampilkan "Mulai percakapan" beserta contoh pertanyaan.',
      },
      {
        title: 'Tulis pertanyaan',
        body: [
          'Klik salah satu contoh atau ketik pertanyaan Anda sendiri di kolom pesan. Enter mengirim pesan, Shift+Enter membuat baris baru. Tombol Dikte mengubah suara menjadi teks.',
        ],
        image: img('02-multi-brain', '02-tulis-pertanyaan'),
        result: 'Pertanyaan muncul di kolom pesan dan tombol Kirim aktif.',
      },
      {
        title: 'Kirim dan tunggu jawaban',
        body: [
          'Setelah dikirim, jawaban AI muncul bertahap (streaming). Anda dapat menekan Hentikan bila jawaban sudah cukup.',
          'Indikator "Guardrails aktif" berarti data pribadi seperti nama, NIK, dan nomor telepon disamarkan sebelum dikirim ke penyedia AI.',
        ],
        image: img('02-multi-brain', '03-jawaban-streaming'),
        result: 'Jawaban sedang ditulis dan percakapan baru tercatat di daftar sebelah kiri.',
      },
      {
        title: 'Baca hasil jawaban',
        body: [
          'Setiap jawaban mencantumkan model yang dipakai, jumlah token, dan waktu. Bila informasi kurang, AI akan meminta klarifikasi seperti contoh di samping.',
        ],
        image: img('02-multi-brain', '04-hasil-jawaban'),
        result: 'Jawaban lengkap tersimpan di percakapan dan judul percakapan diambil dari pertanyaan pertama.',
      },
      {
        title: 'Ajukan pertanyaan lanjutan atau minta dokumen',
        body: [
          'Lanjutkan percakapan untuk memperdalam jawaban. Minta AI membuat tabel, laporan Word, Excel, PowerPoint, atau halaman HTML; dokumen yang dibuat tampil sebagai kartu dan dapat dibuka di panel kanan.',
        ],
        image: img('02-multi-brain', '05-pertanyaan-lanjutan'),
        result: 'AI membuat dokumen "Ringkasan Alur Verifikasi Klaim Santunan" yang dapat disalin atau diunduh.',
        tip: 'Semua dokumen buatan AI juga tersimpan di menu Dokumen Saya.',
      },
      {
        title: 'Tambahkan lampiran sebagai konteks',
        body: [
          'Panel "Lampiran percakapan" menerima Word, Excel, PowerPoint, PDF, atau gambar (maks. 20 MB per berkas), serta tautan halaman web. Lampiran hanya dibaca dalam percakapan tersebut.',
        ],
        image: img('02-multi-brain', '06-panel-lampiran'),
        result: 'Berkas atau tautan yang ditambahkan tercantum di panel dan dipakai AI saat menjawab.',
      },
      {
        title: 'Aktifkan pencarian web bila perlu',
        body: [
          'Nyalakan "Cari di web" agar AI juga mencari informasi publik terbaru. Biarkan mati untuk pertanyaan yang cukup dijawab dari pengetahuan internal.',
        ],
        image: img('02-multi-brain', '07-cari-di-web'),
        permission: 'ai.websearch.use',
        result: 'Jawaban berikutnya dapat menyertakan sumber dari web.',
      },
      {
        title: 'Ekspor atau cetak percakapan',
        body: [
          'Gunakan Ekspor MD untuk menyimpan percakapan sebagai Markdown, Cetak / PDF untuk mencetak, dan Layar penuh untuk fokus. Ikon bintang menandai percakapan penting.',
        ],
        image: img('02-multi-brain', '08-ekspor-cetak'),
        result: 'Percakapan dapat dibagikan sebagai berkas atau dicetak.',
      },
    ],
  },
  {
    id: 'partner',
    hub: 'workspace',
    title: 'Menguji gagasan — Partner',
    summary:
      'Diskusikan gagasan atau rencana dengan AI yang berperan sebagai mitra berpikir, dengan gaya yang bisa dipilih: suportif, penantang asumsi, analis terstruktur, atau pragmatis.',
    audience: 'Manajer dan pengambil keputusan yang ingin menguji rencana sebelum dijalankan',
    permissions: ['ai.counterpart.analyze'],
    steps: [
      {
        title: 'Pilih gaya mitra diskusi',
        body: [
          'Buka Ruang Kerja AI › Partner. Pilih gaya di atas area percakapan: Pendamping Suportif menguatkan ide, Penantang Asumsi mencari celah, Analis Terstruktur memecah masalah, Pragmatis fokus pada eksekusi.',
        ],
        image: img('03-partner', '01-pilih-gaya'),
        result: 'Gaya terpilih ditandai hijau dan deskripsinya tampil di bawahnya.',
      },
      {
        title: 'Tuliskan gagasan yang ingin diuji',
        body: [
          'Jelaskan gagasan, konteks, dan apa yang ingin Anda uji. Contoh: rencana mewajibkan briefing keselamatan 15 menit di awal setiap shift.',
        ],
        image: img('03-partner', '02-tulis-gagasan'),
        result: 'Gagasan siap dikirim dengan gaya "Penantang Asumsi".',
      },
      {
        title: 'Baca tanggapan kritis',
        body: [
          'AI menguji gagasan dari beberapa sudut pandang, mengajukan pertanyaan penantang, dan memberi saran perbaikan. Lanjutkan diskusi sampai rencana Anda matang.',
        ],
        image: img('03-partner', '03-hasil-diskusi'),
        result: 'Tanggapan terstruktur berisi uji efektivitas, dampak operasional, risiko, dan saran.',
        tip: 'Gaya dapat diganti kapan saja di tengah percakapan untuk mendapat sudut pandang lain.',
      },
    ],
  },
  {
    id: 'subordinate',
    hub: 'workspace',
    title: 'Menyerahkan tugas ke agen — Subordinate',
    summary:
      'Bangun agen digital pribadi dengan skill dan konektor data, serahkan tugas tertulis, lalu pantau statusnya dari antrean sampai selesai.',
    audience: 'Pengguna yang ingin mendelegasikan pekerjaan berulang seperti laporan, ringkasan, atau analisis',
    permissions: ['ai.subordinate.execute'],
    steps: [
      {
        title: 'Lihat papan tugas',
        body: [
          'Buka Ruang Kerja AI › Subordinate. Kartu "Alur tugas" merangkum jumlah tugas per tahap, dan papan menampilkan lajur Antre, Berjalan, Perlu tindakan, Selesai, serta Gagal/batal.',
        ],
        image: img('04-subordinate', '01-papan-tugas'),
        result: 'Anda melihat semua tugas beserta statusnya; papan diperbarui otomatis.',
      },
      {
        title: 'Buat agen dari template',
        body: [
          'Buka tab Agent Saya, klik "Dari template". Template disiapkan admin di Pusat Agen AI; pilih yang sesuai lalu klik Gunakan.',
        ],
        image: img('04-subordinate', '02-pilih-template'),
        permission: 'ai.agents.manage',
        result: 'Daftar template agen tampil beserta deskripsinya.',
      },
      {
        title: 'Sesuaikan agen',
        body: [
          'Editor agen terbuka. Atur nama, deskripsi, tanggung jawab, cara kerja, batasan, memori, skill, dan konektor data yang boleh dipakai agen, lalu klik Simpan.',
        ],
        image: img('04-subordinate', '03-editor-agen'),
        permission: 'ai.agents.manage',
        result: 'Agen baru tersimpan dan siap menerima tugas.',
        tip: 'Satu agen untuk satu peran yang jelas. Pasang hanya skill dan konektor yang benar-benar dibutuhkan.',
      },
      {
        title: 'Periksa daftar agen',
        body: ['Tab Agent Saya menampilkan semua agen pribadi Anda. Tombol "Beri tugas" langsung membuka formulir tugas untuk agen tersebut.'],
        image: img('04-subordinate', '04-daftar-agen'),
        permission: 'ai.agents.manage',
        result: 'Agen tercantum dengan status aktif, skill, dan jumlah tugasnya.',
      },
      {
        title: 'Tulis skill untuk metode kerja berulang',
        body: [
          'Di tab Skill, klik "Skill baru". Isi nama, kapan skill dipakai, dan instruksi dalam format Markdown: langkah, aturan, dan format keluaran.',
        ],
        image: img('04-subordinate', '05-skill-baru'),
        permission: 'ai.agents.manage',
        result: 'Formulir skill terisi dan siap disimpan.',
        tip: 'Jangan menyimpan kredensial atau kata sandi di dalam skill.',
      },
      {
        title: 'Simpan dan pasang skill',
        body: ['Skill yang tersimpan dapat dipasang ke satu atau beberapa agen melalui editor agen.'],
        image: img('04-subordinate', '06-daftar-skill'),
        permission: 'ai.agents.manage',
        result: 'Skill baru tercantum di tab Skill.',
      },
      {
        title: 'Gabungkan agen dalam grup',
        body: [
          'Tab Grup menyatukan beberapa agen: pilih Leader, anggota, dan cara kerja (delegasi atau diskusi bergiliran). Grup cocok untuk tugas yang butuh beberapa keahlian.',
        ],
        image: img('04-subordinate', '07-grup-baru'),
        permission: 'ai.agents.manage',
        result: 'Formulir grup baru tampil untuk diisi.',
      },
      {
        title: 'Buat tugas baru',
        body: [
          'Klik "Tugas baru". Pilih agen atau grup yang mengerjakan, beri judul (opsional), dan tulis instruksi: tujuan, cakupan, input, batasan, format hasil, serta kriteria selesai. Klik "Mulai tugas".',
        ],
        image: img('04-subordinate', '08-tugas-baru'),
        result: 'Tugas masuk antrean dan detail tugas langsung terbuka.',
      },
      {
        title: 'Pantau tugas yang berjalan',
        body: [
          'Detail tugas menampilkan jejak eksekusi secara langsung. Bila agen butuh informasi atau persetujuan, tugas pindah ke lajur "Perlu tindakan" dan Anda dapat menjawabnya di kolom instruksi lanjutan.',
        ],
        image: img('04-subordinate', '09-tugas-berjalan'),
        result: 'Status bergerak dari Antre ke Berjalan, lalu Selesai.',
      },
      {
        title: 'Terima hasil tugas',
        body: [
          'Setelah selesai, bagian "Hasil tugas" berisi keluaran agen, misalnya laporan klaim mingguan lengkap dengan tabel dan rekomendasi. Jumlah token dan waktu tercatat di bagian atas.',
        ],
        image: img('04-subordinate', '10-hasil-tugas'),
        result: 'Draf laporan siap ditinjau; beri instruksi lanjutan bila perlu revisi.',
      },
      {
        title: 'Lihat tugas di papan',
        body: ['Tugas yang selesai pindah ke lajur Selesai dan menambah angka pada kartu Alur tugas.'],
        image: img('04-subordinate', '11-papan-selesai'),
        result: 'Papan menampilkan tugas baru di lajur Selesai.',
      },
    ],
  },
  {
    id: 'peta-pikiran',
    hub: 'workspace',
    title: 'Memantau pemikiran tim — Peta pikiran',
    summary:
      'Lihat apa yang sedang dipikirkan tim Anda lewat judul percakapan dan tugas AI per departemen, tanpa membuka isi pesannya.',
    audience: 'Atasan dan manajer departemen',
    permissions: ['ai.mindmap.team.read'],
    steps: [
      {
        title: 'Buka peta organisasi',
        body: [
          'Pilih Ruang Kerja AI › Peta Pikiran. Graf menampilkan departemen sebagai lingkaran dengan angka jumlah judul; panel kanan merangkum departemen terpilih dan subdepartemennya.',
        ],
        image: img('05-peta-pikiran', '01-pemetaan'),
        result: 'Graf seluruh tim dalam cakupan Anda tampil beserta jumlah judul 30 hari terakhir.',
        tip: 'Akses Anda ke peta pikiran tercatat di log audit.',
      },
      {
        title: 'Atur periode dan masuk ke departemen',
        body: [
          'Pilih 7, 30, atau 90 hari, dan nyalakan/matikan mode Multi Brain, Partner, Subordinate. Klik departemen di graf atau di daftar subdepartemen untuk masuk lebih dalam.',
        ],
        image: img('05-peta-pikiran', '02-masuk-departemen'),
        result: 'Graf berpusat pada departemen terpilih dan jejak navigasi tampil di kiri atas.',
      },
      {
        title: 'Lihat judul pemikiran anggota',
        body: [
          'Klik lingkaran orang untuk membuka panelnya: jumlah judul per mode dan daftar judul percakapan serta tugas terbaru. Isi pesan tidak pernah ditampilkan.',
        ],
        image: img('05-peta-pikiran', '03-judul-anggota'),
        result: 'Panel orang terpilih menampilkan daftar judul beserta mode dan tanggalnya.',
      },
      {
        title: 'Gunakan struktur pemikiran',
        body: ['Tab "Struktur pemikiran" mengelompokkan judul berdasarkan topik agar Anda melihat tema yang sedang ramai di tim.'],
        image: img('05-peta-pikiran', '04-struktur-pemikiran'),
        result: 'Topik dan judul terkait tampil sebagai jaringan pemikiran.',
      },
    ],
  },
  {
    id: 'dokumen-riwayat',
    hub: 'workspace',
    title: 'Dokumen saya dan riwayat',
    summary: 'Unduh dokumen yang dibuat AI dan buka kembali percakapan atau tugas yang pernah Anda jalankan.',
    audience: 'Semua pengguna Ruang Kerja AI',
    permissions: ['ai.documents.manage', 'ai.workspace.history.read'],
    steps: [
      {
        title: 'Buka Dokumen Saya',
        body: [
          'Ruang Kerja AI › Dokumen Saya menampilkan semua dokumen buatan AI dari percakapan Anda: judul, format, ukuran, dan tanggal. Hanya Anda yang dapat melihatnya.',
        ],
        image: img('06-dokumen-riwayat', '01-dokumen-saya'),
        permission: 'ai.documents.manage',
        result: 'Daftar dokumen tampil dengan dokumen terbaru di atas.',
      },
      {
        title: 'Unduh atau hapus dokumen',
        body: ['Klik ikon ⋯ di ujung baris untuk mengunduh atau menghapus dokumen.'],
        image: img('06-dokumen-riwayat', '02-menu-baris-dokumen'),
        permission: 'ai.documents.manage',
        result: 'Dokumen terunduh dalam format aslinya (Word, Excel, PowerPoint, HTML, atau Markdown).',
      },
      {
        title: 'Telusuri riwayat percakapan',
        body: [
          'Ruang Kerja AI › Riwayat Percakapan menampilkan percakapan Multi Brain dan Partner Anda. Saring berdasarkan mode, buka detail, atau hapus lewat menu ⋯.',
        ],
        image: img('06-dokumen-riwayat', '03-riwayat-percakapan'),
        permission: 'ai.workspace.history.read',
        result: 'Percakapan tercantum dengan mode dan waktu pembaruan terakhir.',
      },
      {
        title: 'Lihat riwayat tugas',
        body: ['Tab Tugas menampilkan semua tugas Subordinate beserta statusnya.'],
        image: img('06-dokumen-riwayat', '04-riwayat-tugas'),
        permission: 'ai.workspace.history.read',
        result: 'Daftar tugas tampil dan dapat disaring berdasarkan status.',
      },
      {
        title: 'Buka detail tugas',
        body: ['Klik judul tugas untuk melihat instruksi, hasil, dan jejak eksekusi lengkap.'],
        image: img('06-dokumen-riwayat', '05-detail-tugas'),
        permission: 'ai.workspace.history.read',
        result: 'Dialog detail menampilkan hasil tugas dan setiap tahap yang dilalui.',
      },
    ],
  },
  {
    id: 'pengetahuan',
    hub: 'knowledge',
    title: 'Mengelola basis pengetahuan',
    summary:
      'Unggah dokumen perusahaan agar dapat dicari dan dipakai AI, kelompokkan dalam koleksi, lalu temukan jawabannya lewat pencarian pengetahuan.',
    audience: 'Pemilik proses dan admin pengetahuan; pencarian untuk semua karyawan',
    permissions: ['knowledge.documents.read', 'knowledge.search.use', 'knowledge.collections.read'],
    steps: [
      {
        title: 'Pantau dokumen pengetahuan',
        body: [
          'Pusat Pengetahuan › Dokumen menampilkan ringkasan status indeks (Terindeks, Menunggu, Gagal, Sumber) dan daftar dokumen. Saring berdasarkan sumber atau status, dan ekspor daftar ke CSV.',
        ],
        image: img('07-pengetahuan', '01-dokumen-pengetahuan'),
        result: 'Anda tahu berapa dokumen yang siap dipakai AI dan mana yang bermasalah.',
      },
      {
        title: 'Kelola sumber dokumen',
        body: ['Klik "Kelola sumber" untuk menambah sumber baru, misalnya kumpulan SOP satu departemen. Setiap dokumen harus berada dalam satu sumber.'],
        image: img('07-pengetahuan', '02-kelola-sumber'),
        permission: 'knowledge.collections.manage',
        result: 'Sumber baru tersedia saat mengunggah dokumen.',
      },
      {
        title: 'Unggah dokumen',
        body: ['Klik "Unggah dokumen", pilih sumber, isi judul, lalu tempel isi dokumen. Konten langsung diindeks agar bisa dicari AI.'],
        image: img('07-pengetahuan', '03-unggah-dokumen'),
        permission: 'knowledge.collections.manage',
        result: 'Formulir siap disimpan.',
      },
      {
        title: 'Pastikan dokumen terindeks',
        body: ['Setelah disimpan, dokumen muncul di daftar dengan status Terindeks dan angka KPI ikut bertambah.'],
        image: img('07-pengetahuan', '04-dokumen-terindeks'),
        permission: 'knowledge.collections.manage',
        result: 'Dokumen "SOP Briefing Keselamatan Awal Shift" terindeks dan siap dicari.',
        tip: 'Untuk menghapus beberapa dokumen sekaligus, centang barisnya lalu klik tombol hapus di bilah aksi massal.',
      },
      {
        title: 'Kelompokkan dalam koleksi',
        body: ['Pusat Pengetahuan › Koleksi mengelompokkan beberapa sumber per topik, misalnya "Proses Klaim Asuransi".'],
        image: img('07-pengetahuan', '05-koleksi'),
        result: 'Koleksi tampil sebagai kartu dengan jumlah sumbernya.',
      },
      {
        title: 'Atur sumber dalam koleksi',
        body: ['Klik "Atur sumber" pada kartu koleksi untuk memilih sumber yang termasuk di dalamnya.'],
        image: img('07-pengetahuan', '06-atur-sumber-koleksi'),
        permission: 'knowledge.collections.manage',
        result: 'Pencarian dapat dibatasi ke koleksi ini.',
      },
      {
        title: 'Cari jawaban di dokumen',
        body: [
          'Pusat Pengetahuan › Pencarian Pengetahuan. Ketik kata kunci lalu tekan Cari. Hasil menampilkan cuplikan dengan kata kunci tersorot, skor relevansi, dan sumbernya. Gunakan filter Sumber dan Koleksi di kiri untuk mempersempit hasil.',
        ],
        image: img('07-pengetahuan', '07-hasil-pencarian'),
        permission: 'knowledge.search.use',
        result: 'Dokumen paling relevan tampil di urutan teratas.',
      },
      {
        title: 'Tanyakan lebih lanjut ke Multi Brain',
        body: ['Klik "Tanyakan ke Multi Brain" pada hasil pencarian untuk membuka Multi Brain dengan pertanyaan yang sudah terisi.'],
        image: img('07-pengetahuan', '08-tanyakan-multi-brain'),
        permission: 'ai.secondbrain.query',
        result: 'Kolom pesan Multi Brain terisi kata kunci dan judul dokumen, tinggal dikirim.',
      },
    ],
  },
  {
    id: 'agen-persetujuan',
    hub: 'agents',
    title: 'Menjalankan agen dengan persetujuan',
    summary:
      'Gunakan agen standar perusahaan dari Pusat Agen AI. Agen yang tindakannya sensitif menunggu persetujuan manusia sebelum dijalankan.',
    audience: 'Tim operasional, penyetuju, dan admin agen',
    permissions: ['agents.view'],
    steps: [
      {
        title: 'Lihat katalog agen',
        body: [
          'Pusat Agen AI › Katalog Agen menjelaskan alur kerja agen dan menampilkan agen yang tersedia. Lencana "Butuh persetujuan" menandai agen yang wajib disetujui manusia.',
        ],
        image: img('08-agen-persetujuan', '01-katalog-agen'),
        result: 'Anda tahu agen mana yang langsung jalan dan mana yang perlu persetujuan.',
      },
      {
        title: 'Kelola definisi agen',
        body: ['Pusat Agen AI › Kelola Agen menampilkan definisi agen: persona, alat yang boleh dipakai, dan aturan persetujuan.'],
        image: img('08-agen-persetujuan', '02-definisi-agen'),
        result: 'Daftar definisi agen beserta status dan jumlah tugasnya.',
      },
      {
        title: 'Tambah agen baru',
        body: ['Klik "Tambah agen", isi kode, nama, instruksi, alat yang diizinkan, dan tentukan apakah agen wajib disetujui sebelum berjalan.'],
        image: img('08-agen-persetujuan', '03-tambah-agen'),
        permission: 'agents.create',
        result: 'Agen baru tersedia di katalog untuk tim.',
      },
      {
        title: 'Jalankan agen',
        body: ['Pusat Agen AI › Jalankan Tugas. Pilih agen, beri judul, dan tulis instruksi spesifik, lalu klik Jalankan.'],
        image: img('08-agen-persetujuan', '04-jalankan-agen'),
        permission: 'agents.execute',
        result: 'Formulir siap dijalankan; lencana menunjukkan agen ini butuh persetujuan.',
      },
      {
        title: 'Tugas menunggu persetujuan',
        body: ['Untuk agen yang wajib disetujui, tugas tidak langsung dijalankan dan masuk antrean persetujuan.'],
        image: img('08-agen-persetujuan', '05-menunggu-persetujuan'),
        permission: 'agents.execute',
        result: 'Status tugas "Menunggu persetujuan" dan penyetuju menerima notifikasi.',
      },
      {
        title: 'Tinjau antrean persetujuan',
        body: ['Penyetuju membuka Pusat Agen AI › Persetujuan untuk melihat ringkasan tugas, agen, dan peminta.'],
        image: img('08-agen-persetujuan', '06-antrean-persetujuan'),
        permission: 'agents.approve',
        result: 'Permintaan yang menunggu tampil dengan tombol Setujui dan Tolak.',
      },
      {
        title: 'Setujui atau tolak dengan catatan',
        body: ['Klik Setujui atau Tolak, tulis catatan keputusan, lalu konfirmasi. Keputusan tercatat di log audit.'],
        image: img('08-agen-persetujuan', '07-setujui-catatan'),
        permission: 'agents.approve',
        result: 'Tugas yang disetujui langsung dijalankan agen.',
      },
      {
        title: 'Periksa log tugas',
        body: ['Kembali ke Jalankan Tugas. Log tugas menampilkan status akhir setiap tugas; klik judul untuk membuka hasil dan jejak eksekusinya.'],
        image: img('08-agen-persetujuan', '08-log-tugas'),
        permission: 'agents.execute',
        result: 'Tugas yang disetujui berstatus Selesai di urutan teratas.',
      },
    ],
  },
  {
    id: 'integrasi',
    hub: 'integrations',
    title: 'Menghubungkan sistem — Pusat integrasi',
    summary:
      'Hubungkan agen dan percakapan ke sistem lain melalui server MCP, konektor database, dan konektor REST, lalu pantau kesehatannya.',
    audience: 'Admin integrasi dan tim TI',
    permissions: ['integrations.view'],
    steps: [
      {
        title: 'Lihat ringkasan dan peta koneksi',
        body: [
          'Pusat Integrasi › Koneksi & Status menampilkan jumlah koneksi sehat, provider AI aktif, serta peta koneksi dari ContributorAI ke setiap sistem. Garis putus-putus merah berarti koneksi bermasalah.',
        ],
        image: img('09-integrasi', '01-ringkasan-peta'),
        result: 'Anda melihat sekilas sistem mana yang sehat dan mana yang perlu diperiksa.',
      },
      {
        title: 'Periksa kesehatan semua koneksi',
        body: ['Klik "Periksa semua" untuk menguji setiap server MCP, konektor REST, dan konektor database secara berurutan.'],
        image: img('09-integrasi', '02-periksa-semua'),
        permission: 'integrations.configure',
        result: 'Status dan waktu pemeriksaan terakhir diperbarui di setiap baris.',
      },
      {
        title: 'Kelola server MCP',
        body: ['Bagian Server MCP menampilkan alamat, status kesehatan, dan tombol aksi: periksa, hubungkan OAuth, kelola tool, atur akses, atau hapus.'],
        image: img('09-integrasi', '03-server-mcp'),
        result: 'Server MCP terdaftar beserta statusnya.',
      },
      {
        title: 'Atur tool MCP',
        body: [
          'Klik Tool untuk menyinkronkan daftar tool dari server, mengaktifkan atau menonaktifkannya, dan menentukan tool mana yang wajib disetujui manusia setiap kali dipanggil.',
        ],
        image: img('09-integrasi', '04-tool-mcp'),
        permission: 'integrations.configure',
        result: 'Tool read-only langsung jalan; tool lain wajib persetujuan secara bawaan.',
      },
      {
        title: 'Kelola konektor database',
        body: ['Konektor database menghubungkan MySQL, PostgreSQL, Oracle, atau SQL Server. Atur batas baris, waktu tunggu, dan apakah query tulis diizinkan dengan persetujuan.'],
        image: img('09-integrasi', '05-konektor-database'),
        result: 'Konektor tercantum dengan kebijakan dan status kesehatannya.',
      },
      {
        title: 'Berikan akses konektor',
        body: ['Klik Akses untuk memberikan izin baca atau baca + tulis kepada pengguna, peran, grup, atau departemen tertentu.'],
        image: img('09-integrasi', '06-akses-konektor'),
        permission: 'integrations.configure',
        result: 'Hanya pihak yang diberi akses dapat memakai konektor di percakapan dan agen.',
      },
      {
        title: 'Kelola konektor REST',
        body: ['Konektor REST memanggil API internal sebagai tool agen. Daftarkan alamat dasar, jenis autentikasi, dan endpoint yang boleh dipanggil.'],
        image: img('09-integrasi', '07-konektor-rest'),
        result: 'Konektor REST tercantum dan dapat diperiksa kesehatannya.',
      },
      {
        title: 'Periksa ketersediaan kredensial',
        body: ['Pusat Integrasi › Kredensial menampilkan variabel lingkungan yang dibutuhkan dan statusnya. Nilai rahasia tidak pernah ditampilkan di browser.'],
        image: img('09-integrasi', '08-kredensial'),
        result: 'Anda tahu kredensial mana yang sudah terkonfigurasi di server.',
      },
    ],
  },
  {
    id: 'akses-pengguna',
    hub: 'admin',
    title: 'Mengelola akses pengguna',
    summary:
      'Tambahkan pengguna, kelompokkan dalam grup dan departemen, lalu berikan peran berisi permission yang menentukan menu dan data yang boleh diakses.',
    audience: 'Administrator sistem',
    permissions: ['rbac.users.read', 'rbac.groups.read', 'rbac.departments.read', 'rbac.roles.read', 'rbac.permissions.read', 'rbac.policies.read'],
    steps: [
      {
        title: 'Lihat daftar pengguna',
        body: [
          'Administrasi › Pengguna menampilkan jumlah pengguna total, aktif, dan nonaktif. Pilih baris untuk melihat detail di panel kanan: departemen, status, waktu masuk terakhir, dan tombol aksi.',
        ],
        image: img('10-akses', '01-pengguna'),
        permission: 'rbac.users.read',
        result: 'Detail pengguna terpilih tampil tanpa meninggalkan daftar.',
      },
      {
        title: 'Tambah pengguna',
        body: ['Klik "Tambah pengguna", isi nama, email, kata sandi awal (minimal 10 karakter), dan departemen.'],
        image: img('10-akses', '02-tambah-pengguna'),
        permission: 'rbac.users.manage',
        result: 'Pengguna baru dapat masuk; berikan peran agar menunya muncul.',
      },
      {
        title: 'Atur peran dan grup pengguna',
        body: ['Buka detail pengguna untuk mengubah profil, mengatur ulang kata sandi, menonaktifkan akun, menambah peran, dan melihat keanggotaan grup.'],
        image: img('10-akses', '03-detail-pengguna'),
        permission: 'rbac.users.manage',
        result: 'Perubahan peran berlaku dalam beberapa detik dan tercatat di log audit.',
      },
      {
        title: 'Buat grup',
        body: ['Administrasi › Grup › "Tambah grup". Grup menyatukan pengguna lintas departemen agar peran dapat diberikan sekaligus.'],
        image: img('10-akses', '04-tambah-grup'),
        permission: 'rbac.groups.manage',
        result: 'Formulir grup terisi kode, nama, dan deskripsi.',
      },
      {
        title: 'Periksa daftar grup',
        body: ['Grup baru tampil dengan jumlah anggota dan peran. Menu ⋯ menyediakan Ubah dan Hapus.'],
        image: img('10-akses', '05-daftar-grup'),
        permission: 'rbac.groups.read',
        result: 'Grup tersimpan dan siap diisi anggota.',
      },
      {
        title: 'Tambah anggota grup',
        body: ['Buka grup, klik "Tambah anggota", cari nama atau email, centang pengguna, lalu Simpan. Tambahkan peran grup di bagian bawah.'],
        image: img('10-akses', '06-tambah-anggota'),
        permission: 'rbac.groups.manage',
        result: 'Anggota mewarisi semua peran yang diberikan ke grup.',
      },
      {
        title: 'Susun struktur departemen',
        body: ['Administrasi › Departemen menampilkan bagan organisasi. Klik kartu untuk detail, seret untuk menggeser, dan gunakan tombol +/− untuk membuka cabang.'],
        image: img('10-akses', '07-departemen'),
        permission: 'rbac.departments.read',
        result: 'Struktur organisasi menentukan cakupan data peran bertipe departemen.',
      },
      {
        title: 'Kelola peran',
        body: ['Administrasi › Peran menampilkan peran sistem dan peran kustom beserta jumlah permission dan penugasannya.'],
        image: img('10-akses', '08-peran'),
        permission: 'rbac.roles.read',
        result: 'Klik nama peran untuk mengatur permission-nya.',
      },
      {
        title: 'Atur matriks permission peran',
        body: ['Centang permission yang diberikan peran ini, dikelompokkan per aplikasi dan modul. Perubahan langsung berlaku untuk semua pengguna dan grup dengan peran tersebut.'],
        image: img('10-akses', '09-matriks-permission'),
        permission: 'rbac.roles.manage',
        result: 'Menu yang tampil bagi pengguna mengikuti permission perannya.',
      },
      {
        title: 'Lihat katalog permission',
        body: ['Administrasi › Katalog Permission mendaftar semua hak akses yang dikenal sistem beserta jumlah peran yang memakainya.'],
        image: img('10-akses', '10-katalog-permission'),
        permission: 'rbac.permissions.read',
        result: 'Anda dapat memastikan permission mana yang belum dipakai peran mana pun.',
      },
      {
        title: 'Buat kebijakan allow/deny',
        body: ['Administrasi › Kebijakan › "Tambah kebijakan" untuk aturan khusus di luar peran, misalnya melarang satu grup mengakses permission tertentu. Aturan deny menang atas allow pada prioritas yang sama.'],
        image: img('10-akses', '11-tambah-kebijakan'),
        permission: 'rbac.policies.manage',
        result: 'Kebijakan diterapkan pada evaluasi izin berikutnya.',
      },
    ],
  },
  {
    id: 'audit-diagnostik',
    hub: 'admin',
    title: 'Audit dan diagnostik akses',
    summary:
      'Periksa mengapa seseorang punya atau tidak punya akses, uji skenario otorisasi tanpa mengubah data, dan telusuri jejak peristiwa di log audit.',
    audience: 'Administrator sistem dan auditor',
    permissions: ['rbac.effective.inspect', 'rbac.authz.test', 'audit.logs.read'],
    steps: [
      {
        title: 'Periksa permission efektif pengguna',
        body: [
          'Administrasi › Permission Efektif. Cari pengguna untuk melihat peran aktifnya dan keputusan untuk setiap permission: diizinkan atau ditolak, alasannya, dan cakupannya.',
          'Dari halaman Pengguna, tombol "Periksa permission efektif" langsung membuka halaman ini untuk pengguna terpilih.',
        ],
        image: img('11-audit', '01-permission-efektif'),
        permission: 'rbac.effective.inspect',
        result: 'Daftar 44 keputusan permission untuk pengguna terpilih.',
      },
      {
        title: 'Telusuri jejak evaluasi',
        body: ['Klik nama permission untuk melihat urutan aturan yang dievaluasi: peran, grup, dan kebijakan yang menentukan hasil akhir.'],
        image: img('11-audit', '02-jejak-evaluasi'),
        permission: 'rbac.effective.inspect',
        result: 'Anda tahu persis aturan mana yang memberi atau menolak akses.',
      },
      {
        title: 'Uji skenario otorisasi',
        body: ['Administrasi › Uji Otorisasi. Pilih pengguna dan permission, opsional jenis, ID, dan pemilik resource, lalu klik "Jalankan uji". Tidak ada data yang diubah.'],
        image: img('11-audit', '03-uji-otorisasi'),
        permission: 'rbac.authz.test',
        result: 'Hasil evaluasi menampilkan keputusan, alasan, cakupan, dan jejaknya.',
      },
      {
        title: 'Telusuri log audit',
        body: ['Administrasi › Log Audit mencatat peristiwa keamanan, perubahan konfigurasi, dan operasi administratif. Saring berdasarkan tingkat, kunci peristiwa, atau ringkasan.'],
        image: img('11-audit', '04-log-audit'),
        permission: 'audit.logs.read',
        result: 'Peristiwa terbaru tampil di urutan teratas beserta aktor dan entitasnya.',
      },
      {
        title: 'Buka detail peristiwa',
        body: ['Klik peristiwa untuk melihat detail lengkap: waktu, aktor, alamat IP, entitas, dan data tambahan.'],
        image: img('11-audit', '05-detail-peristiwa'),
        permission: 'audit.logs.read',
        result: 'Detail peristiwa siap dipakai untuk investigasi atau laporan audit.',
      },
    ],
  },
  {
    id: 'konfigurasi-platform',
    hub: 'admin',
    title: 'Konfigurasi platform',
    summary:
      'Atur struktur menu, konfigurasi aplikasi, sesi aktif, provider AI, prioritas pencarian web, dan perlindungan data pribadi (guardrails).',
    audience: 'Administrator platform',
    permissions: ['nav.manage', 'config.read', 'security.sessions.manage', 'providers.health.read', 'ai.guardrails.manage'],
    steps: [
      {
        title: 'Atur struktur navigasi',
        body: [
          'Administrasi › Navigasi menampilkan aplikasi, modul, fitur, dan item menu beserta permission yang menjaganya. Tambah, ubah, atau hapus untuk mengatur sidebar semua pengguna.',
        ],
        image: img('12-platform', '01-navigasi'),
        permission: 'nav.manage',
        result: 'Perubahan langsung memengaruhi sidebar pengguna yang berhak.',
      },
      {
        title: 'Lihat konfigurasi aplikasi',
        body: ['Administrasi › Konfigurasi berisi pengaturan non-rahasia yang tersimpan di basis data, misalnya batas kunci akun dan durasi sesi.'],
        image: img('12-platform', '02-konfigurasi'),
        permission: 'config.read',
        result: 'Setiap kunci tampil dengan nilai, visibilitas, dan waktu pembaruan.',
      },
      {
        title: 'Ubah nilai konfigurasi',
        body: ['Klik Ubah pada baris, masukkan nilai baru, lalu simpan. Perubahan berlaku tanpa restart server.'],
        image: img('12-platform', '03-ubah-konfigurasi'),
        permission: 'config.manage',
        result: 'Nilai baru langsung dipakai aplikasi dan tercatat di log audit.',
      },
      {
        title: 'Pantau dan cabut sesi aktif',
        body: ['Administrasi › Sesi menampilkan sesi masuk yang aktif: pengguna, alamat IP, perangkat, dan kedaluwarsa. Gunakan menu ⋯ untuk mencabut sesi yang mencurigakan.'],
        image: img('12-platform', '04-sesi-aktif'),
        permission: 'security.sessions.manage',
        result: 'Sesi yang dicabut harus masuk ulang.',
      },
      {
        title: 'Periksa provider AI dan pencarian web',
        body: ['Administrasi › Provider AI menampilkan status setiap penyedia model bahasa. Seret penyedia pencarian web untuk mengatur urutan prioritasnya.'],
        image: img('12-platform', '05-provider-ai'),
        permission: 'providers.health.read',
        result: 'Penyedia nomor 1 dicoba lebih dulu; penyedia tanpa kunci API dilewati.',
      },
      {
        title: 'Aktifkan guardrails',
        body: [
          'Administrasi › Guardrails. Bagian "Yang diterima LLM" mencontohkan bagaimana data pribadi disamarkan. Nyalakan guardrails dan pilih apakah lampiran gambar diblokir.',
        ],
        image: img('12-platform', '06-guardrails'),
        permission: 'ai.guardrails.manage',
        result: 'Data pribadi disamarkan sebelum dikirim ke penyedia AI; pengguna tetap melihat data asli.',
      },
      {
        title: 'Pilih jenis data yang dilindungi',
        body: ['Centang kategori data pribadi sesuai UU PDP 27/2022 dan POJK 22/2023, tambahkan istilah khusus per baris, lalu klik "Simpan perubahan".'],
        image: img('12-platform', '07-guardrails-kategori'),
        permission: 'ai.guardrails.manage',
        result: 'Kategori dan istilah yang dipilih selalu disamarkan dalam permintaan ke LLM.',
      },
    ],
  },
];
