# 🐺 Ma Sói Online — Project Deploy Vercel

Ứng dụng chơi **Ma Sói (Werewolf)** đa thiết bị theo thời gian thực, hỗ trợ đầy đủ luồng Quản trò tự động bằng giọng đọc tiếng Việt và đồng bộ phòng chơi trực tiếp trên **Vercel**.

## ✨ Tính năng chính

1. **Chủ phòng (Host) tạo phòng & cấu hình thông số**:
   - Tùy chỉnh **Thời gian thảo luận**, **Thời gian vote nghi phạm**, **Thời gian biện hộ**, **Thời gian vote treo cổ**, và **Thời gian mỗi lượt gọi Role ban đêm**.
   - Chia sẻ đường link vào phòng (`https://<ten-mien>.vercel.app/?room=SOIxxx`) cho người chơi khác.
2. **Tự động đề xuất số lượng Role cân bằng hoặc Chủ phòng tự chỉnh**:
   - **Chế độ Tự động cân bằng (Auto-Balance)**: Hệ thống tự tính toán số lượng *Ma Sói, Tiên Tri, Bảo Vệ, Phù Thủy, Thợ Săn, Thần Tình Yêu Cupid, Dân Làng* tối ưu theo tổng số người tham gia.
   - **Chế độ Thủ công**: Chủ phòng tăng/giảm (`+` / `-`) từng Role kèm thanh đo tỷ lệ cân bằng giữa Phe Dân Làng và Phe Ma Sói.
3. **Hiển thị Lá Bài Role trên từng máy người chơi**:
   - Khi bắt đầu và trong suốt ván đấu, điện thoại/máy tính của mỗi người chơi hiển thị lá bài 3D của đúng Role đó (kèm tính năng chạm để úp/lật lá bài tránh lộ bài).
4. **Giọng nói Quản Trò ban đêm (Chỉ phát trên máy Chủ phòng)**:
   - Khi về đêm, hệ thống gọi lần lượt từng Role theo đúng thứ tự chuẩn Ma Sói (*Cupid -> Bảo Vệ -> Ma Sói -> Tiên Tri -> Phù Thủy*) bằng **Web Speech API (`vi-VN`)** kết hợp hiệu ứng âm thanh đêm.
   - Âm thanh **chỉ phát ra ở máy Chủ phòng**, không phát ở máy người chơi để tránh lộ vị trí người cầm Role.
5. **Tự tổng kết sau đêm & Option giọng đọc kết quả buổi sáng**:
   - Khi hết đêm, hệ thống tự động xử lý các tương tác (*Sói cắn, Bảo Vệ đỡ, Phù Thủy cứu/độc, Tình nhân chết theo*) và gửi thông báo kết quả tới **tất cả các máy**.
   - Tích hợp sẵn checkbox **Option có giọng đọc kết quả buổi sáng qua máy Chủ phòng**.
6. **Chu trình Ban Ngày chuẩn xác**:
   - **Hết đêm** ➔ Tự động tính **Giờ Thảo Luận**.
   - **Hết giờ thảo luận** ➔ Hiện danh sách tên các nhân vật còn sống để mọi người **Vote Nghi Phạm**.
   - **Sau khi mọi người vote** ➔ Đưa người bị tình nghi cao nhất lên bục và bắt đầu tính **Giờ Biện Hộ**.
   - **Sau khi hết giờ biện hộ** ➔ Mở vòng **Vote Phán Quyết (Treo Cổ / Tha Mạng)**, kiểm tra điều kiện thắng thua hoặc chuyển sang Đêm tiếp theo.

## 🚀 Hướng dẫn Deploy lên Vercel

1. Đẩy thư mục project này lên GitHub Repository hoặc giải nén file zip.
2. Truy cập [vercel.com/new](https://vercel.com/new) và chọn **Import** repository (hoặc chạy `npx vercel --prod` trong thư mục).
