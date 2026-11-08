# Hướng dẫn cho Claude

## Pull request

- **Mỗi yêu cầu thêm tính năng, cập nhật hay sửa lỗi đều phải có một pull request mới, riêng cho yêu cầu đó.** Làm xong, commit và push thì tạo PR luôn, không cần chờ được nhắc.
- Mỗi PR một nhánh riêng, tách từ `main` mới nhất (`git fetch origin main`, rồi tạo nhánh từ `origin/main`). Không thêm commit của yêu cầu mới vào nhánh của một PR khác, kể cả PR còn đang mở.
- PR đã merge là xong: không push thêm vào nhánh đó. Việc tiếp theo đi trên nhánh mới, PR mới.
- PR nhắm vào `main`. Tiêu đề và mô tả viết bằng tiếng Việt: tóm tắt thay đổi, rồi phần kiểm tra (kết quả `npm test`, đã chạy thử trên trình duyệt hay chưa).
- Trước khi tạo PR: `npm test` phải qua hết và `npm run coverage` phải đạt 100% (dòng, nhánh, hàm) cho `lib/`, `api/`, `public/shared/`. Code mới cần test đi kèm. Thay đổi giao diện thì chạy thử bằng `npm run dev` ở cỡ màn hình điện thoại.
