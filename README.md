# 🌕 Ma Sói Online

Chơi Ma Sói cùng bạn bè, mỗi người một điện thoại. Máy của chủ phòng đặt giữa bàn làm **quản trò**: đọc lời dẫn bằng giọng tiếng Việt, gọi từng vai trò thức dậy và điều khiển nhịp ván chơi.

- **Vercel làm máy chủ phòng**: toàn bộ luật chơi chạy trong Vercel Function `api/room.js`. Không dùng broker public, không cần WebRTC.
- **Supabase** lưu trạng thái phòng (Postgres) và báo cho các máy biết khi phòng có thay đổi (Realtime). Kênh Realtime chỉ chở số phiên bản, không chở dữ liệu ván chơi.
- **Không lộ bài**: mỗi máy chỉ nhận đúng thông tin mình được biết. Máy chủ kiểm tra mọi hành động (đúng lượt, đúng vai trò, còn sống).
- **Vào lại được**: tải lại trang, mất mạng hay khoá màn hình đều quay về đúng ván cũ.

## Vai trò

Ma Sói, Tiên Tri, Bảo Vệ, Phù Thủy, Thợ Săn, Thần Tình Yêu, Dân Làng. Hệ thống tự gợi ý số lượng cân bằng theo số người chơi (4–18 người); chủ phòng có thể tự chỉnh.

Diễn biến mỗi vòng: đêm (Thần Tình Yêu ở đêm đầu, rồi Bảo Vệ, Ma Sói, Tiên Tri, Phù Thủy) → công bố người chết → thảo luận → bỏ phiếu nghi phạm → biện hộ → phán quyết treo cổ/tha → đêm tiếp theo.

Không ai ngoài Ma Sói biết ai bị cắn: Phù Thủy dùng bình Cứu "mù" (cứu người bị cắn đêm đó nếu có, bình vẫn mất nếu đêm đó Sói không cắn ai). Thợ Săn chết vì bất kỳ lý do gì cũng được bắn, nên cả làng không đoán được nguyên nhân cái chết.

## Deploy lên Vercel + Supabase

1. Tạo project trên [supabase.com](https://supabase.com) (gói Free là đủ). Vào **SQL Editor**, chạy nội dung file `supabase/schema.sql`.
2. Import repository vào Vercel ([vercel.com/new](https://vercel.com/new)). Framework Preset: **Other**. Không cần build command.
3. Thêm biến môi trường cho project trên Vercel. Cách nhanh nhất là cài tích hợp **Supabase** trong Vercel Marketplace (tự điền các biến). Hoặc lấy trong Supabase → Project Settings → API rồi điền tay:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (hoặc secret key `sb_secret_…`, đặt tên `SUPABASE_SECRET_KEY`). Chỉ dùng ở server, **không bao giờ** đưa ra trình duyệt.
   - `SUPABASE_ANON_KEY` (hoặc publishable key `sb_publishable_…`, đặt tên `SUPABASE_PUBLISHABLE_KEY`). Trình duyệt dùng key này chỉ để nghe kênh Realtime.
4. Redeploy. Mở trang, tạo phòng, bấm **Mời bạn bè** để gửi link.

> Thiếu cấu hình Supabase thì API báo lỗi “Chưa cấu hình Supabase” thay vì chạy sai. Nếu tắt kênh public trong Supabase (Realtime → Settings → chỉ cho phép kênh private), các máy sẽ tự chuyển sang hỏi máy chủ mỗi 1–1,5 giây.

**Chi phí và giới hạn:**
- Mỗi máy chỉ gọi API khi có thay đổi (ping Realtime), khi hết giờ một bước, và kiểm tra định kỳ mỗi 15 giây. Đo thực tế: khoảng 8 lần/phút với người chơi, 12 lần/phút với chủ phòng. Ván 10 người trong 1 giờ tốn khoảng 5–7 nghìn lượt gọi Vercel Function.
- Supabase không tính phí theo số truy vấn. Gói Free giới hạn số kết nối Realtime đồng thời và số tin nhắn mỗi tháng (mỗi thay đổi trong phòng là 1 tin nhắn gửi tới mỗi máy), dư sức cho chơi giữa bạn bè.
- Project Supabase gói Free sẽ **tạm dừng nếu 7 ngày không có hoạt động**. Khi đó vào Supabase Dashboard bấm Restore.
- Phòng không hoạt động quá 12 giờ sẽ tự bị xoá.

## Giọng quản trò

Máy chủ phòng phát giọng theo thứ tự ưu tiên:

1. **File MP3 có sẵn** trong `public/audio/` (liệt kê trong `manifest.json`). Giọng tự nhiên, giống nhau trên mọi máy.
2. Nếu thiếu file: dùng **giọng tiếng Việt của trình duyệt** (Chrome/Edge có giọng “Online/Natural” khá tốt), có ngắt nghỉ theo dấu câu.

Lời dẫn nằm trong `public/shared/voice-lines.js`. Mỗi câu có 1–3 biến thể để không lặp nhàm chán. Số ghế được đọc bằng các file `seat_N` (“Người chơi số ba”).

### Tạo file giọng miễn phí, không cần API key

Dùng [edge-tts](https://github.com/rany2/edge-tts) với giọng neural tiếng Việt của Microsoft: `vi-VN-NamMinhNeural` (nam, trầm) hoặc `vi-VN-HoaiMyNeural` (nữ).

**Cách 1: GitHub Actions (không cần cài gì)**
Vào tab **Actions → Tạo giọng quản trò → Run workflow**, chọn nhánh và giọng. Workflow tự tạo các file MP3 và commit vào nhánh đó.

**Cách 2: chạy trên máy bạn**
```bash
pip install edge-tts
npm run voice                              # giọng nam NamMinh
VOICE=vi-VN-HoaiMyNeural FORCE=1 npm run voice   # đổi sang giọng nữ, tạo lại tất cả
```

Lưu ý: edge-tts dùng dịch vụ đọc văn bản của trình duyệt Edge, không phải API chính thức có cam kết. Phù hợp cho dự án cá nhân; nếu dùng thương mại, hãy chuyển sang dịch vụ TTS có giấy phép.

**Cách 3: tự thu âm** (tự nhiên và có cảm xúc nhất)
Thu các câu trong `voice-lines.js`, lưu thành `public/audio/<key>_<biến thể>.mp3` (ví dụ `werewolf_wake_0.mp3`, `seat_3_0.mp3`), rồi chạy `node scripts/generate-voice.mjs --manifest-only`. Có thể chỉ thu một phần: câu nào thiếu file sẽ dùng giọng trình duyệt.

## Chạy ở máy cá nhân

```bash
npm run dev      # http://localhost:3000, lưu phòng trong RAM, giả lập Realtime
npm test         # test luật chơi (node:test, không cần cài thư viện)
```

Thêm `?debug=1` vào URL để chủ phòng có nút **Thêm bot thử nghiệm**. Bot tự hành động, giúp thử cả ván chơi chỉ với một máy. Nút này không hiện ở chế độ thường.

## Cấu trúc

```
api/room.js              Vercel Function: tạo/vào phòng, nhận hành động, trả trạng thái
lib/engine.js            Luật chơi (hàm thuần, có test)
lib/store.js             Supabase (PostgREST + Realtime broadcast), compare-and-set; RAM khi chạy local
public/js/realtime.js    Nghe kênh Realtime của phòng (SSE giả lập khi chạy local)
supabase/schema.sql      Bảng rooms + RLS
public/index.html        Trang duy nhất
public/js/app.js         Giao diện
public/js/narrator.js    Giọng quản trò, hiệu ứng âm thanh, âm thanh nền
public/shared/           Định nghĩa vai trò và lời dẫn (dùng chung server/client)
scripts/                 Dev server, tạo file giọng
test/engine.test.js      Test luật chơi
```
