export default {
	async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
	  // Cloudflare に secret として登録した OpenAI API キー
	  const apiKey = env.OPENAI_API_KEY;
  
	  const url = new URL(request.url);
  
	  if (url.pathname.startsWith("/whisper")) {
		// === Whisper APIへの代理リクエスト ===
		// multipart/form-dataをそのまま転送する例
		const openaiEndpoint = "https://api.openai.com/v1/audio/transcriptions";
  
		// ヘッダーを組み立て。Content-Typeはクライアントから受け取ったものをそのまま使用
		const headers = new Headers({
		  "Authorization": `Bearer ${apiKey}`,
		  "Content-Type": request.headers.get("content-type") || "application/octet-stream"
		});
  
		// OpenAI APIに代理送信
		const response = await fetch(openaiEndpoint, {
		  method: "POST",
		  headers,
		  body: request.body
		});
  
		// 結果をそのまま返す
		return response;
  
	  } else if (url.pathname.startsWith("/chat")) {
		// === ChatCompletion等への代理リクエスト ===
		const openaiEndpoint = "https://api.openai.com/v1/chat/completions";
  
		// クライアントから受け取ったJSONを取り出す
		const reqBody = await request.json();
  
		const response = await fetch(openaiEndpoint, {
		  method: "POST",
		  headers: {
			"Authorization": `Bearer ${apiKey}`,
			"Content-Type": "application/json"
		  },
		  body: JSON.stringify(reqBody)
		});
		return response;
  
	  } else {
		// それ以外のパスは 404
		return new Response("Not found", { status: 404 });
	  }
	},
  };
  