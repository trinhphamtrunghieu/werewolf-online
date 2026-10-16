# 🌕 Ma Sói Online

Chơi Ma Sói cùng bạn bè, mỗi người một điện thoại. Máy của chủ phòng đặt giữa bàn làm **quản trò**: đọc lời dẫn bằng giọng tiếng Việt, gọi từng vai trò thức dậy và điều khiển nhịp ván chơi.

- **Vercel làm máy chủ phòng**: toàn bộ luật chơi chạy trong Vercel Function `api/room.js`. Không dùng broker public, không cần WebRTC.
- **Upstash Redis** lưu trạng thái phòng (tự xoá sau 6 giờ).
- **Không lộ bài**: mỗi máy chỉ nhận đúng thông tin mình được biết. Máy chủ kiểm tra mọi hành động (đúng lượt, đúng vai trò, còn sống).
- **Vào lại được**: tải lại trang, mất mạng hay khoá màn hình đều quay về đúng ván cũ.

## Vai trò

Ma Sói, Tiên Tri, Bảo Vệ, Phù Thủy, Thợ Săn, Thần Tình Yêu, Dân Làng. Hệ thống tự gợi ý số lượng cân bằng theo số người chơi (4–18 người); chủ phòng có thể tự chỉnh.

Diễn biến mỗi vòng: đêm (Thần Tình Yêu ở đêm đầu, rồi Bảo Vệ, Ma Sói, Tiên Tri, Phù Thủy) → công bố người chết → thảo luận → bỏ phiếu nghi phạm → biện hộ → phán quyết treo cổ/tha → đêm tiếp theo.

## Deploy lên Vercel

1. Import repository vào Vercel ([vercel.com/new](https://vercel.com/new)). Framework Preset: **Other**. Không cần build command.
2. Trong project trên Vercel, vào **Storage → Create Database → Upstash (Redis)** rồi kết nối với project. Vercel tự thêm biến môi trường `KV_REST_API_URL` / `KV_REST_API_TOKEN` (hoặc `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). Code đọc được cả hai kiểu tên.
3. Redeploy. Mở trang, tạo phòng, bấm **Mời bạn bè** để gửi link.

> Nếu thiếu Upstash, API sẽ báo lỗi “Chưa cấu hình Upstash Redis” thay vì chạy sai. Function trên Vercel không chia sẻ bộ nhớ RAM, nên phòng sẽ biến mất ngẫu nhiên nếu không có Redis.

**Chi phí**: mỗi máy hỏi trạng thái máy chủ khoảng mỗi 1–1,5 giây (khi ẩn tab thì 5 giây), mỗi lần hỏi là 1 lệnh Redis. Ván 10 người trong 1 giờ tốn khoảng 25–30 nghìn lệnh. Hãy xem hạn mức miễn phí hiện tại của Upstash và Vercel để ước lượng.

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
npm run dev      # http://localhost:3000, lưu phòng trong RAM
npm test         # test luật chơi (node:test, không cần cài thư viện)
```

Thêm `?debug=1` vào URL để chủ phòng có nút **Thêm bot thử nghiệm**. Bot tự hành động, giúp thử cả ván chơi chỉ với một máy. Nút này không hiện ở chế độ thường.

## Cấu trúc

```
api/room.js              Vercel Function: tạo/vào phòng, nhận hành động, trả trạng thái
lib/engine.js            Luật chơi (hàm thuần, có test)
lib/store.js             Upstash Redis REST + compare-and-set (bộ nhớ RAM khi chạy local)
public/index.html        Trang duy nhất
public/js/app.js         Giao diện
public/js/narrator.js    Giọng quản trò, hiệu ứng âm thanh, âm thanh nền
public/shared/           Định nghĩa vai trò và lời dẫn (dùng chung server/client)
scripts/                 Dev server, tạo file giọng
test/engine.test.js      Test luật chơi
```
