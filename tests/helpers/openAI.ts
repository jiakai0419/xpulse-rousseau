export function installPipelineOpenAIStub(): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const schemaName = body.text.format.name;
    const userText = body.input[1].content[0].text;
    const posts = JSON.parse(userText).posts;

    if (schemaName === "x_post_scores") {
      return new Response(
        JSON.stringify({
          model: "gpt-test-scoring",
          output_text: JSON.stringify({
            scores: posts.map((post, index) => ({
              id: post.id,
              immediateValue: Math.max(1, 10 - index),
              immediateValueReason: `Test score for ${post.id}.`,
              informationDensity: Math.max(1, 9 - index),
              informationDensityReason: `Test density for ${post.id}.`,
            })),
          }),
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        }),
        { status: 200 },
      );
    }

    if (schemaName === "x_post_translations") {
      return new Response(
        JSON.stringify({
          model: "gpt-test-translation",
          output_text: JSON.stringify({
            translations: posts.map((post) => ({
              id: post.id,
              textZh: `测试翻译：${post.text}`,
            })),
          }),
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected schema ${schemaName}`);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}
