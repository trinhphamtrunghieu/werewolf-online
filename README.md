# 🌕 Ma Sói Online

Chơi Ma Sói cùng bạn bè, mỗi người một điện thoại. Máy của chủ phòng đặt giữa bàn làm **quản trò**: đọc lời dẫn bằng giọng tiếng Việt, gọi từng vai trò thức dậy và điều khiển nhịp ván chơi.

- **Vercel làm máy chủ phòng**: toàn bộ luật chơi chạy trong Vercel Function `api/room.js`. Không dùng broker public, không cần WebRTC.
- **Supabase** lưu trạng thái phòng (Postgres) và báo cho các máy biết khi phòng có thay đổi (Realtime). Kênh Realtime chỉ chở số phiên bản, không chở dữ liệu ván chơi.
- **Không lộ bài**: mỗi máy chỉ nhận đúng thông tin mình được biết. Máy chủ kiểm tra mọi hành động (đúng lượt, đúng vai trò, còn sống).
- **Vào lại được**: tải lại trang, mất mạng hay khoá màn hình đều quay về đúng ván cũ.

## Vai trò

Ma Sói, Tiên Tri, Bảo Vệ, Phù Thủy, Thợ Săn, Thần Tình Yêu, Ăn Trộm, Người Thổi Sáo, Già Làng, Dân Làng. Hệ thống tự gợi ý số lượng cân bằng theo số người chơi (4–18 người) với các vai trò cơ bản. Ăn Trộm, Người Thổi Sáo và Già Làng do chủ phòng tự thêm.

**Mỗi lượt đêm gồm 3 khoảng cố định** (chủ phòng chỉnh được trong Cài đặt ván chơi): **gọi dậy** (vừa đủ để quản trò đọc câu gọi, rồi bắt đầu đếm giờ ngay), **thao tác 30 giây** (người được gọi chọn trên điện thoại), rồi **kêu đi ngủ**: quản trò đọc "… hãy nhắm mắt lại", nghỉ **1 giây** và gọi luôn vai tiếp theo trong cùng một mạch đọc. Lượt luôn chạy đủ thời gian, kể cả khi đã chọn xong hoặc người giữ vai đã chết, nên không ai đoán được gì từ độ dài của lượt.

**Thứ tự thức dậy mỗi đêm** (vai trò nào không có trong ván thì bỏ qua; vai trò có trong ván mà người giữ đã chết thì vẫn được gọi, để không lộ ai còn sống):

1. **Ăn Trộm** (đêm đầu): xem 2 lá bài dư, có thể đổi lấy 1 lá. Nếu cả 2 lá đều là Ma Sói thì bắt buộc phải lấy.
2. **Thần Tình Yêu** (đêm đầu): chọn 2 người làm cặp đôi.
3. **Cặp đôi** (đêm đầu): mở mắt nhìn mặt nhau.
4. **Bảo Vệ**: chọn 1 người để bảo vệ (không trùng người của đêm trước).
5. **Ma Sói**: nhận diện đồng đội và thống nhất chọn nạn nhân.
6. **Tiên Tri**: chọn 1 người để xem phe.
7. **Phù Thủy**: được hỏi có muốn dùng bình hay không. Phù Thủy **không biết** ai bị cắn; bình Cứu cứu người bị cắn đêm đó nếu có, và vẫn mất nếu đêm đó Sói không cắn ai.
8. **Người Thổi Sáo**: thôi miên 2 người chưa bị thôi miên.
9. **Những người bị thôi miên**: mở mắt nhìn nhau.
10. **Già Làng** (đêm đầu): mở mắt để quản trò biết. Già Làng chịu được 1 lần bị Sói cắn. Nếu chính dân làng giết Già Làng (treo cổ, bình Độc, súng Thợ Săn), Tiên Tri, Bảo Vệ, Phù Thủy và Thợ Săn mất chức năng đến hết ván.
11. **Thợ Săn**: chĩa súng vào 1 người. Khi Thợ Săn chết vì bất kỳ lý do gì, người đó chết theo. Đêm nào không chọn thì súng vẫn chĩa vào người của đêm trước.

Ban ngày: công bố người chết → thảo luận → bỏ phiếu nghi phạm → biện hộ → phán quyết treo cổ/tha → đêm tiếp theo.

**Điều kiện thắng:** Phe Dân thắng khi hết Sói và Người Thổi Sáo (nếu có) đã chết. Phe Sói thắng khi số Sói bằng hoặc nhiều hơn số người còn lại. Người Thổi Sáo thắng khi mọi người còn sống đều đã bị thôi miên. Cặp đôi khác phe thắng khi họ là 2 người cuối cùng còn sống.

## Deploy lên Vercel + Supabase

1. Tạo project trên [supabase.com](https://supabase.com) (gói Free là đủ), **chọn Region: Southeast Asia (Singapore)**. Vào **SQL Editor**, chạy nội dung file `supabase/schema.sql`.
2. Import repository vào Vercel ([vercel.com/new](https://vercel.com/new)). Framework Preset: **Other**. Không cần build command.
3. Thêm biến môi trường cho project trên Vercel. Cách nhanh nhất là cài tích hợp **Supabase** trong Vercel Marketplace (tự điền các biến). Hoặc lấy trong Supabase → Project Settings → API rồi điền tay:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (hoặc secret key `sb_secret_…`, đặt tên `SUPABASE_SECRET_KEY`). Chỉ dùng ở server, **không bao giờ** đưa ra trình duyệt.
   - `SUPABASE_ANON_KEY` (hoặc publishable key `sb_publishable_…`, đặt tên `SUPABASE_PUBLISHABLE_KEY`). Trình duyệt dùng key này chỉ để nghe kênh Realtime.
4. Redeploy. Mở trang, tạo phòng, bấm **Mời bạn bè** để gửi link.

> Thiếu cấu hình Supabase thì API báo lỗi “Chưa cấu hình Supabase” thay vì chạy sai. Nếu tắt kênh public trong Supabase (Realtime → Settings → chỉ cho phép kênh private), các máy sẽ tự chuyển sang hỏi máy chủ mỗi 1–1,5 giây.

**Độ trễ giữa các máy:** Function chạy ở Singapore (`"regions": ["sin1"]` trong `vercel.json`), gần Việt Nam. Mỗi lần đồng bộ, Function phải gọi Supabase vài lần, nên **Supabase cũng phải ở Singapore**; lệch vùng (ví dụ Supabase ở Mỹ) sẽ cộng thêm vài trăm mili giây cho mỗi lần gọi. Nếu project Supabase hiện tại ở vùng khác, hãy tạo project mới ở Singapore rồi chạy lại `schema.sql` (phòng chơi là dữ liệu tạm, không cần chuyển dữ liệu). Trên màn hình chơi, dòng trạng thái cho biết đang "đồng bộ tức thì" (Realtime chạy) hay "đồng bộ định kỳ" (Realtime chưa chạy). Mở trang với `?debug=1` để xem thêm thời gian mỗi lần gọi máy chủ. Trong DevTools, header `Server-Timing` của `/api/room` cho biết thời gian gọi Supabase.

**Chi phí và giới hạn:**
- Mỗi máy chỉ gọi API khi có thay đổi (ping Realtime), khi hết giờ một bước, và kiểm tra định kỳ mỗi 15 giây. Đo thực tế: khoảng 8 lần/phút với người chơi, 12 lần/phút với chủ phòng. Ván 10 người trong 1 giờ tốn khoảng 5–7 nghìn lượt gọi Vercel Function.
- Supabase không tính phí theo số truy vấn. Gói Free giới hạn số kết nối Realtime đồng thời và số tin nhắn mỗi tháng (mỗi thay đổi trong phòng là 1 tin nhắn gửi tới mỗi máy), dư sức cho chơi giữa bạn bè.
- Project Supabase gói Free sẽ **tạm dừng nếu 7 ngày không có hoạt động**. Khi đó vào Supabase Dashboard bấm Restore.
- Phòng không hoạt động quá 12 giờ sẽ tự bị xoá.

## Máy chủ phòng

Máy chủ phòng chỉ có 3 việc: **phát âm thanh** (lời quản trò, nhạc nền, tích tắc), **bắt đầu ván** và **mở ván mới** (kèm chỉnh cài đặt ở phòng chờ). Nhịp ván do server điều khiển, nên nếu máy chủ phòng rớt mạng thì ván vẫn chạy, chỉ tạm thời không có tiếng.

**Khi máy chủ phòng mất kết nối** (không có tín hiệu quá 12 giây), mọi máy hiện khung **chọn máy làm loa mới**. Phiếu được chốt khi có người đạt quá nửa số người đang online, hoặc khi mọi người đã bầu xong, hoặc sau 20 giây kể từ phiếu đầu tiên. Nếu hoà phiếu thì bốc thăm ngẫu nhiên giữa những người hoà. Máy chủ phòng mới không thấy thêm bài của ai; bảng quản trò chỉ dành cho chủ phòng không tham gia chơi.

**Tuỳ chọn trên từng máy** (lưu trên máy đó, mặc định tắt):
- *Phát âm thanh trên máy này*: máy người chơi cũng đọc lời quản trò.
- *Rung khi đến lượt*: chỉ hiện trên điện thoại hỗ trợ rung (trình duyệt trên iPhone không cho trang web rung).

## Giọng quản trò

Máy chủ phòng phát giọng theo thứ tự ưu tiên:

1. **File MP3 có sẵn** trong `public/audio/` (liệt kê trong `manifest.json`). Giọng tự nhiên, giống nhau trên mọi máy.
2. Nếu thiếu file: dùng **giọng tiếng Việt của trình duyệt** (Chrome/Edge có giọng “Online/Natural” khá tốt), có ngắt nghỉ theo dấu câu.

Lời dẫn nằm trong `public/shared/voice-lines.js`. Mỗi đoạn có 5–6 phiên bản, mỗi lần đọc chọn ngẫu nhiên để không lặp nhàm chán. Số ghế được đọc bằng các file `seat_N` (“Người chơi số ba”).

**Nhịp đọc:** máy chủ biết độ dài từng câu (`public/shared/voice-durations.js`, do script tạo giọng ghi ra) và **không chuyển bước khi quản trò còn đang đọc**. Thời gian của mỗi bước (lượt ban đêm, thảo luận, bỏ phiếu…) chỉ bắt đầu tính sau khi đọc xong. Sau phán quyết ban ngày, quản trò báo “Màn đêm sẽ buông xuống sau mười giây nữa” rồi tự chuyển sang đêm. Trong 10 giây cuối của mỗi bước, máy chủ phòng phát tiếng tích tắc (tắt được trong phần Giọng quản trò). Script tạo giọng tự cắt khoảng lặng thừa ở đầu và cuối mỗi file (cần ffmpeg), để “người chơi số ba… và… người chơi số năm” đọc liền mạch.

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
