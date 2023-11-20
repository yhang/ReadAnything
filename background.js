// Register the context menu item
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: 'explain',
      title: 'Explain',
      contexts: ['selection'],
    });

    chrome.contextMenus.create({
      id: 'translate',
      title: 'Translate',
      contexts: ['selection'],
    });
  });
  
  // Listen for the context menu item click
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'explain') {
      const selectedText = info.selectionText;
      getSimplifiedText(selectedText, tab.id);
    }
    else if(info.menuItemId == 'translate'){
      const selectedText = info.selectionText;
      getTranslatedText(selectedText, tab.id)
    }
  });
  
  async function getTranslatedText(text, tabId) {
    try {
      // send a waiting message to the content script
      chrome.tabs.sendMessage(tabId, { waiting: true });
      const model = await getStoredModel();
      const lang = await getStoredLanguage();
      const data = getCallDataForTranslate(lang, model, text)
      // Call the OpenAI API with the selected text (placeholder)
      const translatedText = await callOpenAI(data, tabId);
  
      // Send the simplified text to the content script
      chrome.tabs.sendMessage(tabId, { translatedText });
    } catch (error) {
      console.error('Error getting simplified text:', error);
    }
  }

  async function getSimplifiedText(text, tabId) {
    try {
      // send a waiting message to the content script
      chrome.tabs.sendMessage(tabId, { waiting: true });
      // Define the request data (model and messages)
      const model = await getStoredModel();
      const lang = await getStoredLanguage();
      const data = getCallDataForSimplify(lang, model, text);
      // Call the OpenAI API with the selected text (placeholder)
      const simplifiedText = await callOpenAI(data, tabId);
      // Send the simplified text to the content script
      chrome.tabs.sendMessage(tabId, { simplifiedText });
    } catch (error) {
      console.error('Error getting simplified text:', error);
    }
  }

  async function callOpenAI(data, tabId) {
    // Get the stored API key
    const apiKey = await getStoredAPIKey();
  
    // if (lang == 'zh') {
    //   // Call GPT-3 API to translate the text to Chinese
    //   chrome.tabs.sendMessage(tabId, { token: "（中文版本会在英文版之后给出）\n\n" })
    // }

    const raw_content = await readStream(data, apiKey, tabId);

    // if (lang == 'zh') {
    //   // Call GPT-3 API to translate the text to Chinese
    //   await translate_zh(raw_content, tabId)
    // }
  }

  function getCallDataForTranslate(lang, model, text){
    let finish = "";
    let instructions = "";

    const data = {
      model: model,
      max_tokens: 1024,
      temperature: 1,
      stream: true,
      messages: [
        { role: "system", content: "你是一个大学英语老师" },
        {
          role: "user", content: `\
          我会提供一段文字，请进行双语翻译。\
          翻译时保留原文内容，自动合理断句，在每句英文下方加上最符合原文意思的中文翻译，不做任何解释，\
          仔细一步步思考，找到原文中有学习价值的单词或短语，用Markdown语法加粗显示。 \
          输出格式： \
          ## 对照翻译 \
          <原句1（含加粗的有用单词或词组）> \
          <中文翻译1（加粗对照翻译）> \
          <原句2（含加粗有用的单词或词组）> \ 
          <中文翻译2（加粗对照翻译）> \
          ... \
          处理样例：\ 
          原文：It’s a small unassuming word by itself. One I’d not thought much about before... \
          输出结果： \
          ## 对照翻译 \
          It’s a small **unassuming** word by itself. \
          它是一个独自**无足轻重**的小词。 \
          One I’d not **thought much about** before. \
          这是我以前**没有多想过**的一个词。 \
          ...` },
        { role: "assistant", content: "当然可以，为了进行双语翻译，请您提供想要翻译的文字段落。"},
        { role: "user", content: text},
      ],
    };
    return data;
  }

  function getCallDataForSimplify(lang, model, text) {
    let finish = "";
    let instructions = "";
  
    if (lang == 'zh') {
      // add sentence to the end of the text to make sure the translation is correct
      finish = "我会用中文回答你的问题。";
      instructions = "请用中文回答我。";
    }

    const data = {
      model: model,
      max_tokens: 1024,
      temperature: 1,
      stream: true,
      messages: [
        { role: "system", content: "You are a high school teacher who is good at explaining complex concepts to students." },
        {
          role: "user", content: `\
  Please help me explain some complex sentences from papers to high school students. \
  You need to try your best to attract their attention and make them understand the concepts. \
  Please connects the key points with questions and examples to make it attractive. \
  Please use examples, imagnations, questions, and analogies to make it vivid and concrete.\
  Please directly explain without any thing like "let me give it a try" or anything similar.` },
        {
          role: "assistant", content: `\
  Sure! As a passionate high school teacher, I thrive on using an informative \
  and popular science writing style that weaves in scientific terminology and analogies to \
  make even the most complex concepts effortlessly understandable. Give me your sentences and \
  let's get started! I will explain the sentences in a vivid and concrete way for best understanding. \
  Don't hesitate - send it my way!` + finish
        },
        { role: "user", content: text + instructions },
      ],
    };
    return data;
  }

  function extractContent(jsonStr) {
    let contents ='';
    // 使用 'data:' 分割原始字符串
    // 注意：第一个元素会是一个空字符串，所以需要过滤掉
    const dataItems = jsonStr.split('data:').filter(item => item);

    dataItems.forEach(item => {
      try {
        // 尝试解析每行为JSON对象
        const json = JSON.parse(item);
    
        // 如果解析成功且存在content字段，则提取它
        if (json.choices && json.choices[0].delta && json.choices[0].delta.content) {
          contents += json.choices[0].delta.content;
        }
      } catch (e) {
        // 如果解析失败（不是有效的JSON），则忽略该行
      }
    })
    return contents;
  }

async function readStream(data, apiKey, tabId) {
  let raw_content = "";
  // Define the URL for the OpenAI API endpoint
  const url = "https://api.openai.com/v1/chat/completions";
  
  try {
    // Make a POST request to the OpenAI API
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(data),
    });

    // Check if the response is successful (status code 200-299)
    if (!response.ok) {
       // First, parse the response body
       const errorData = await response.json();
       // Then, log the error data
       console.error('Error data:', errorData);
      throw new Error(`OpenAI API request failed with status ${response.status}`);
    }

    // Read the response as a stream
    const reader = response.body.getReader();

    // Process the stream
    while (true) {
      const { value, done } = await reader.read();
      // stop the stram if chrome.runtime.sendMessage({ stopStream: true });
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.stopStream) {
          reader.releaseLock();
        }
      });
      
      if (done) {
        console.log("Done reading stream")
        // close the stream
        reader.releaseLock();
        break
      };

      // Parse the value as a string
      const token = new TextDecoder("utf-8").decode(value);

      const content = extractContent(token);

      raw_content += token;

      // Send the content to the content script
      chrome.tabs.sendMessage(tabId, { token: content });

    }
  } catch (error) {
    console.error("Error calling OpenAI API:", error.message);
  }
  return raw_content;
}


async function translate_zh(raw_content, tabId){
  // Translate the text to Chinese
  // Get the stored API key
  chrome.tabs.sendMessage(tabId, { token: "\n\n 中文版本：\n" })
  const apiKey = await getStoredAPIKey();
  
  // Define the URL for the OpenAI API endpoint

  // Define the request data (model and messages)
  const model = getStoredModel();

  const data = {
    model: model,
    max_tokens: 1024,
    temperature: 1,
    stream: true,
    messages: [
      { role: "system", content: "You are a good translator who can translate English to Chinese in a fluent way."},
      { role: "user", content: "Please translate the following text to Chinese:\n" + raw_content}
    ],
  };

  await readStream(data, apiKey, tabId);
}
  
function getStoredAPIKey() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(['apiKey'], (result) => {
        resolve(result.apiKey);
      });
    });
  }
  
function getStoredModel() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(['model'], (result) => {
        resolve(result.model||'gpt-4');
        });
    });
    }

function getStoredLanguage() {
    return new Promise((resolve, reject) => {
        chrome.storage.sync.get(['language'], (result) => {
        resolve(result.language||'en');
        });
    });
    }