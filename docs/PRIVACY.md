# プライバシーポリシー（pi-calendar）

pi-calendarは、利用者本人が自宅のRaspberry Piで動かす個人用の壁掛けカレンダーです。

## 取得する情報
- Googleカレンダーの予定とカレンダー一覧（読み取り専用scope `calendar.events.readonly` と `calendar.calendarlist.readonly`）。
- 予定の作成・変更・削除は行いません。

## 利用目的と保存先
- 取得した予定は、利用者のRaspberry Pi上の画面に表示するためだけに使います。
- 予定とOAuthトークンはそのPiのローカルストレージにだけ保存します。開発者や第三者のサーバーには送信しません。

## 第三者提供
- 取得した情報を第三者へ提供・販売しません。広告にも使いません。
- Google APIから受け取った情報の利用は、[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)（Limited Use要件を含む）に従います。

## 削除
- Piの状態ディレクトリを削除すると、保存された予定とトークンが消えます。
- Googleアカウントの「サードパーティのアクセス」からアクセス権を取り消すこともできます。

## 連絡先
https://github.com/inai17ibar/pi-calendar/issues
